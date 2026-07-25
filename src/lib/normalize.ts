import type { Category } from '../types'
import { canvasToBlob, trimTransparentTracked } from './image'
import type { PoseAnchor } from './pose'
import { garmentAnchors, maskFromBlob, symmetryTilt } from './silhouette'

/**
 * Post-extraction normalization: straighten the garment, then place it on a
 * standard per-category frame so every piece presents uniformly — hoodies
 * photographed at odd angles end up looking like catalog shots.
 *
 * Straightening prefers the body tilt measured from pose landmarks and falls
 * back to the garment's own axis of symmetry, so flat-lays and hanger shots
 * (which have no pose to read) get straightened too.
 *
 * Placement anchors tops by their shoulder line and bottoms by their
 * waistband, scaled so that line is always the same width. Sizing by anatomy
 * rather than by bounding box is what stops a cropped tee from presenting the
 * same size as a long coat.
 */

/**
 * Standard width:height per category, matched to the mannequin slots in
 * `components/Avatar.tsx` so garments fill their slot without letterboxing.
 * Keep these in sync with `SLOTS` there.
 */
const FRAME_ASPECT: Record<Category, number> = {
  hat: 114 / 74,
  top: 208 / 218,
  layer: 240 / 244,
  bottom: 164 / 238,
  shoes: 184 / 92,
}

/** Longest edge of every normalized garment. Also caps what lands in IndexedDB. */
const OUTPUT_LONG_EDGE = 1024

/** Transparent margin kept on the constraining axis. */
const PAD = 0.04

/**
 * Where the hang line sits on the standard frame, and how wide the garment's
 * measured body is, as fractions of the frame. Categories missing here are
 * simply fitted to the frame — a hat or a shoe has no line to hang from.
 *
 * `width` is compared against the torso/hip measurement from `garmentAnchors`,
 * not the full silhouette, so it's set well under 1: a flat-lay tee's sleeves
 * span roughly 1.8x its torso and still need to fit.
 */
const CANON: Partial<Record<Category, { y: number; width: number }>> = {
  top: { y: 0.15, width: 0.5 },
  // A jacket is parsed as 'Upper-clothes' exactly like a top, so it gets the
  // same treatment; the mannequin's wider layer slot is what makes it read as
  // the outer piece.
  layer: { y: 0.15, width: 0.5 },
  bottom: { y: 0.07, width: 0.52 },
}

const MIN_TILT = 3
const MAX_TILT = 35

export interface FrameSize {
  w: number
  h: number
}

/** Pixel dimensions of a category's standard frame. */
export function frameSize(category: Category): FrameSize {
  const aspect = FRAME_ASPECT[category]
  return aspect >= 1
    ? { w: OUTPUT_LONG_EDGE, h: Math.round(OUTPUT_LONG_EDGE / aspect) }
    : { w: Math.round(OUTPUT_LONG_EDGE * aspect), h: OUTPUT_LONG_EDGE }
}

function usableTilt(deg: number | null): deg is number {
  return (
    deg !== null && Number.isFinite(deg) && Math.abs(deg) >= MIN_TILT && Math.abs(deg) <= MAX_TILT
  )
}

export async function normalizeGarment(
  blob: Blob,
  category: Category,
  tiltDeg: number | null,
  anchor: PoseAnchor | null = null,
): Promise<Blob> {
  let out = blob
  let tilt = tiltDeg
  // The anchor is in pixels of `blob`, so it has to be carried through the same
  // rotate-and-crop the image goes through or it stops pointing at the body.
  let point = anchor
  if (!usableTilt(tilt)) {
    // No body in frame (or the landmarks weren't confident) — read the tilt off
    // the garment's own outline instead.
    const mask = await maskFromBlob(blob).catch(() => null)
    tilt = mask ? symmetryTilt(mask, category, MAX_TILT) : null
  }
  if (usableTilt(tilt)) {
    const rotated = await straighten(out, tilt).catch(() => null)
    if (rotated) {
      out = rotated.blob
      if (point) point = rotatePoint(point, tilt, rotated.from, rotated.to)
    }
  }
  const trimmed = await trimTransparentTracked(out).catch(() => null)
  if (trimmed) {
    out = trimmed.blob
    if (point) point = { x: point.x - trimmed.offsetX, y: point.y - trimmed.offsetY }
  }
  return placeOnFrame(out, category, point).catch(() => out)
}

interface Straightened {
  blob: Blob
  from: { w: number; h: number }
  to: { w: number; h: number }
}

async function straighten(blob: Blob, tiltDeg: number): Promise<Straightened | null> {
  const bmp = await createImageBitmap(blob)
  try {
    const rad = (-tiltDeg * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    const w = Math.ceil(bmp.width * cos + bmp.height * sin)
    const h = Math.ceil(bmp.width * sin + bmp.height * cos)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.translate(w / 2, h / 2)
    ctx.rotate(rad)
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
    return {
      blob: await canvasToBlob(canvas),
      from: { w: bmp.width, h: bmp.height },
      to: { w, h },
    }
  } finally {
    bmp.close()
  }
}

/** Put a point through the same rotation `straighten` applied to the pixels. */
function rotatePoint(
  p: PoseAnchor,
  tiltDeg: number,
  from: { w: number; h: number },
  to: { w: number; h: number },
): PoseAnchor {
  const rad = (-tiltDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - from.w / 2
  const dy = p.y - from.h / 2
  return {
    x: to.w / 2 + dx * cos - dy * sin,
    y: to.h / 2 + dx * sin + dy * cos,
  }
}

/** Keep a drawn rect inside its frame, preferring the requested offset. */
function clampOffset(offset: number, drawn: number, frame: number): number {
  if (drawn >= frame) return Math.min(0, Math.max(frame - drawn, offset))
  return Math.min(frame - drawn, Math.max(0, offset))
}

/**
 * Draw the trimmed garment onto its standard frame, aligning the hang line to
 * the canonical position when the category has one. The anchor scale is capped
 * at whatever fits, so an unusually long piece shrinks rather than getting
 * cropped — alignment matters, but not enough to cut a hem off.
 */
export async function placeOnFrame(
  blob: Blob,
  category: Category,
  poseAnchor: PoseAnchor | null = null,
): Promise<Blob> {
  const { w, h } = frameSize(category)
  const canon = CANON[category]
  const mask = canon ? await maskFromBlob(blob).catch(() => null) : null
  let anchors = mask ? garmentAnchors(mask, category) : null

  const bmp = await createImageBitmap(blob)
  try {
    // When there's a body in the photo, the shoulder/waist line it gives us
    // beats the silhouette's guess at where the garment hangs from — that guess
    // assumes typical proportions for the category and drifts on worn shots.
    //
    // Width is deliberately still measured from the silhouette: pose landmarks
    // sit at joint centres, not at the garment's edge, so they're not on the
    // same scale as the CANON widths every other path is tuned against. Mixing
    // them would make the same shirt present at two sizes depending on whether
    // someone happened to be wearing it.
    if (anchors && poseAnchor) {
      // The two sources don't measure quite the same line: the silhouette puts
      // its hang line `lineDepth` below the garment's top edge, while the pose
      // landmark sits on the shoulder (or hip) joint itself. Shifting the pose
      // point down by that same gap makes both target one convention, so a
      // shirt doesn't present at two different heights depending on whether
      // someone happened to be wearing it in the photo.
      const drop = anchors.y - anchors.top
      const y = poseAnchor.y / bmp.height + drop
      const centerX = poseAnchor.x / bmp.width
      // Ignore a landmark the crop cut away — it no longer marks anything.
      if (y >= 0 && y <= 1 && centerX >= 0 && centerX <= 1) {
        anchors = { ...anchors, y, centerX }
      }
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const fit = Math.min(
      (w * (1 - 2 * PAD)) / bmp.width,
      (h * (1 - 2 * PAD)) / bmp.height,
    )
    let scale = fit
    let dx = (w - bmp.width * fit) / 2
    let dy = (h - bmp.height * fit) / 2

    if (canon && anchors) {
      scale = Math.min((canon.width * w) / (anchors.width * bmp.width), fit)
      dx = clampOffset(w / 2 - anchors.centerX * bmp.width * scale, bmp.width * scale, w)
      dy = clampOffset(canon.y * h - anchors.y * bmp.height * scale, bmp.height * scale, h)
    }

    ctx.drawImage(bmp, dx, dy, bmp.width * scale, bmp.height * scale)
    return await canvasToBlob(canvas)
  } finally {
    bmp.close()
  }
}

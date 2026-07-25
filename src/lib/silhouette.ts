import type { Category } from '../types'

/**
 * Silhouette analysis — reads the garment's own shape out of its alpha
 * channel. Body pose only exists when someone is wearing the piece, so
 * flat-lays, hanger shots and the background-removal fallback used to get no
 * straightening at all; the outline is always there. This also measures where
 * the garment hangs from (shoulder line, waistband) so pieces can be scaled by
 * their anatomy instead of by their bounding box.
 */

export interface Mask {
  /** 1 where the garment is, 0 elsewhere. Row-major, `width * height`. */
  data: Uint8Array
  width: number
  height: number
}

/** Analysis runs on a downscaled probe — shape, not detail, is what matters. */
const PROBE = 160
const ALPHA_ON = 16

/** Rasterize a cutout's alpha channel into a small binary mask. */
export async function maskFromBlob(blob: Blob, probe = PROBE): Promise<Mask | null> {
  const bmp = await createImageBitmap(blob)
  try {
    const scale = Math.min(probe / bmp.width, probe / bmp.height, 1)
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const out = new Uint8Array(w * h)
    let on = 0
    for (let i = 0; i < out.length; i++) {
      if (data[i * 4 + 3] > ALPHA_ON) {
        out[i] = 1
        on++
      }
    }
    return on > 0 ? { data: out, width: w, height: h } : null
  } finally {
    bmp.close()
  }
}

/** Occupancy grid resolution used when scoring mirror symmetry. */
const GRID = 72
const MIN_POINTS = 60
/** Below this the shape simply isn't mirror-symmetric — don't trust the peak. */
const MIN_SYMMETRY = 0.55
/** The peak must beat leaving the photo alone by this much to be worth it. */
const MIN_GAIN = 0.02

/** Garments whose silhouette has a meaningful vertical axis of symmetry. */
const SYMMETRIC: Category[] = ['hat', 'top', 'bottom']

interface Points {
  xs: Float32Array
  ys: Float32Array
  n: number
  cx: number
  cy: number
  scale: number
}

function onPixels(mask: Mask): Points | null {
  const { data, width, height } = mask
  let n = 0
  for (let i = 0; i < data.length; i++) if (data[i]) n++
  if (n < MIN_POINTS) return null
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  let k = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue
      xs[k] = x
      ys[k] = y
      sx += x
      sy += y
      k++
    }
  }
  const cx = sx / n
  const cy = sy / n
  let maxR = 1
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx
    const dy = ys[i] - cy
    const r = Math.hypot(dx, dy)
    if (r > maxR) maxR = r
  }
  // Fixed across angles so scores stay comparable as the shape rotates.
  return { xs, ys, n, cx, cy, scale: (GRID - 1) / (2 * maxR) }
}

/**
 * How well the shape mirrors about a vertical line through its centroid once
 * rotated by `rad`. Intersection-over-union of the shape and its reflection.
 */
function symmetryScore(p: Points, rad: number, grid: Uint8Array): number {
  grid.fill(0)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const mid = (GRID - 1) / 2
  for (let i = 0; i < p.n; i++) {
    const dx = p.xs[i] - p.cx
    const dy = p.ys[i] - p.cy
    const gx = Math.round((dx * cos - dy * sin) * p.scale + mid)
    const gy = Math.round((dx * sin + dy * cos) * p.scale + mid)
    if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) grid[gy * GRID + gx] = 1
  }
  let inter = 0
  let union = 0
  for (let y = 0; y < GRID; y++) {
    const row = y * GRID
    for (let x = 0; x < GRID; x++) {
      const a = grid[row + x]
      const b = grid[row + (GRID - 1 - x)]
      if (a & b) inter++
      if (a | b) union++
    }
  }
  return union ? inter / union : 0
}

/**
 * The garment's tilt in the photo, found by rotating the silhouette until it
 * is most mirror-symmetric. Sign matches `garmentTilt` in `pose.ts` so both
 * feed the same straightening step. Returns null when the shape has no clear
 * symmetry axis — an asymmetric piece rotated to "best" symmetry would look
 * worse than leaving it be.
 */
export function symmetryTilt(mask: Mask, category: Category, maxDeg = 35): number | null {
  if (!SYMMETRIC.includes(category)) return null
  const p = onPixels(mask)
  if (!p) return null
  const grid = new Uint8Array(GRID * GRID)
  const score = (deg: number) => symmetryScore(p, (deg * Math.PI) / 180, grid)

  let bestDeg = 0
  let bestScore = -1
  for (let deg = -maxDeg; deg <= maxDeg; deg += 3) {
    const s = score(deg)
    if (s > bestScore) {
      bestScore = s
      bestDeg = deg
    }
  }
  // Refine around the coarse peak.
  for (let deg = bestDeg - 2.5; deg <= bestDeg + 2.5; deg += 0.5) {
    if (Math.abs(deg) > maxDeg) continue
    const s = score(deg)
    if (s > bestScore) {
      bestScore = s
      bestDeg = deg
    }
  }
  if (bestScore < MIN_SYMMETRY) return null
  if (bestScore - score(0) < MIN_GAIN) return null
  // Rotating the shape by `bestDeg` uprights it, so the garment sits at -bestDeg.
  return -bestDeg
}

export interface Anchors {
  /** The line the garment hangs from, as a fraction of image height. */
  y: number
  /** Garment width at that line, as a fraction of image width. */
  width: number
  /** Horizontal midpoint at that line, as a fraction of image width. */
  centerX: number
}

interface AnchorSpec {
  /**
   * The line the garment hangs from, as a fraction of its own height measured
   * down from the top edge. Tops hang from the shoulder seam just under the
   * collar; bottoms hang from the waistband at the very top.
   */
  lineDepth: number
  /**
   * Depth range averaged to measure the garment's width. Deliberately *not*
   * the hang line: a flat-lay tee has its sleeves splayed out at the shoulder
   * while a worn one has them hanging down the torso, so width measured up
   * there would scale the same shirt differently depending on how it was
   * photographed. Below the armpits both look alike.
   */
  widthBand: [number, number]
}

const ANCHORS: Partial<Record<Category, AnchorSpec>> = {
  top: { lineDepth: 0.05, widthBand: [0.55, 0.75] },
  bottom: { lineDepth: 0.03, widthBand: [0.12, 0.24] },
}

/** Rows either side of the hang line that get averaged, as a fraction of height. */
const BAND = 0.03

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Locate the line a garment hangs from and how wide it is there, so pieces can
 * be aligned and scaled by their anatomy rather than their bounding box — which
 * is what makes a cropped tee and a long coat present at the same size.
 * Returns null for categories without a meaningful hang line (hats, shoes).
 */
export function garmentAnchors(mask: Mask, category: Category): Anchors | null {
  const spec = ANCHORS[category]
  if (!spec) return null
  const { data, width, height } = mask

  // Horizontal extent of every occupied row.
  const left = new Int32Array(height).fill(-1)
  const right = new Int32Array(height).fill(-1)
  let topY = -1
  let bottomY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (!data[row + x]) continue
      if (left[y] < 0) left[y] = x
      right[y] = x
    }
    if (left[y] >= 0) {
      if (topY < 0) topY = y
      bottomY = y
    }
  }
  if (topY < 0 || bottomY <= topY) return null

  const span = bottomY - topY
  const extentAt = (y: number) => (left[y] < 0 ? null : right[y] - left[y] + 1)

  // Width, averaged over the presentation-invariant band.
  const widths: number[] = []
  for (let y = Math.round(topY + spec.widthBand[0] * span); y <= topY + spec.widthBand[1] * span; y++) {
    if (y < 0 || y >= height) continue
    const e = extentAt(y)
    if (e !== null) widths.push(e)
  }
  if (widths.length === 0) return null
  const w = median(widths)
  if (w < 2) return null

  // Hang line, averaged over a narrow band so one frayed row can't shift it.
  const lineY = topY + spec.lineDepth * span
  const half = Math.max(1, Math.round(BAND * span))
  let lineRows = 0
  for (let y = Math.round(lineY) - half; y <= Math.round(lineY) + half; y++) {
    if (y >= 0 && y < height && left[y] >= 0) lineRows++
  }
  if (lineRows === 0) return null

  // Centre from every occupied row — the piece has already been straightened,
  // so its median midpoint is a steadier centre than any single row's.
  const centers: number[] = []
  for (let y = topY; y <= bottomY; y++) {
    if (left[y] >= 0) centers.push((left[y] + right[y] + 1) / 2)
  }
  if (centers.length === 0) return null

  return { y: lineY / height, width: w / width, centerX: median(centers) / width }
}

import type { Category } from '../types'
import { canvasToBlob, trimTransparent } from './image'

/**
 * Post-extraction normalization: straighten the garment using the body tilt
 * measured from pose landmarks, trim it, then center it on a standard
 * per-category frame so every piece presents uniformly — hoodies photographed
 * at odd angles end up looking like catalog shots.
 */

/** Standard width:height per category. */
const FRAME_ASPECT: Record<Category, number> = {
  hat: 1.25,
  top: 0.9,
  bottom: 0.7,
  shoes: 1.4,
}

const MIN_TILT = 3
const MAX_TILT = 35

export async function normalizeGarment(
  blob: Blob,
  category: Category,
  tiltDeg: number | null,
): Promise<Blob> {
  let out = blob
  if (
    tiltDeg !== null &&
    Number.isFinite(tiltDeg) &&
    Math.abs(tiltDeg) >= MIN_TILT &&
    Math.abs(tiltDeg) <= MAX_TILT
  ) {
    out = await straighten(out, tiltDeg).catch(() => out)
  }
  out = await trimTransparent(out).catch(() => out)
  return frameToStandard(out, category).catch(() => out)
}

async function straighten(blob: Blob, tiltDeg: number): Promise<Blob> {
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
    if (!ctx) return blob
    ctx.translate(w / 2, h / 2)
    ctx.rotate(rad)
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
    return await canvasToBlob(canvas)
  } finally {
    bmp.close()
  }
}

export async function frameToStandard(blob: Blob, category: Category, pad = 0.05): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  try {
    const aspect = FRAME_ASPECT[category]
    const w = Math.ceil(Math.max(bmp.width, bmp.height * aspect) / (1 - 2 * pad))
    const h = Math.ceil(w / aspect)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bmp, Math.round((w - bmp.width) / 2), Math.round((h - bmp.height) / 2))
    return await canvasToBlob(canvas)
  } finally {
    bmp.close()
  }
}

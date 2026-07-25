/** A region of an image in fractional coordinates (0–1 of width/height). */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** Cut a fractional region out of an image at full native resolution. */
export async function cropBlob(blob: Blob, rect: CropRect): Promise<Blob> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const sx = Math.round(rect.x * bmp.width)
    const sy = Math.round(rect.y * bmp.height)
    const sw = Math.max(1, Math.round(rect.w * bmp.width))
    const sh = Math.max(1, Math.round(rect.h * bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
    return await canvasToBlob(canvas)
  } finally {
    bmp.close()
  }
}

/** A trimmed image plus where its top-left landed in the original. */
export interface Trimmed {
  blob: Blob
  /** Pixels removed from the left/top edge — subtract to move a point across. */
  offsetX: number
  offsetY: number
}

/**
 * Crop away fully-transparent margins (plus a small padding) so a cutout
 * garment fills its mannequin slot instead of floating in empty canvas.
 * The alpha scan runs on a downscaled probe to stay cheap on big photos;
 * the actual crop happens at native resolution. Returns the original blob
 * if there's nothing to trim.
 */
export async function trimTransparent(blob: Blob, padFrac = 0.02): Promise<Blob> {
  return (await trimTransparentTracked(blob, padFrac)).blob
}

/**
 * As `trimTransparent`, but reports how far the crop moved the image. Callers
 * carrying coordinates measured on the untrimmed image (body landmarks, say)
 * need the offset to keep those points pointing at the same pixels.
 */
export async function trimTransparentTracked(blob: Blob, padFrac = 0.02): Promise<Trimmed> {
  const untouched: Trimmed = { blob, offsetX: 0, offsetY: 0 }
  const bmp = await createImageBitmap(blob)
  try {
    const scale = Math.min(320 / bmp.width, 320 / bmp.height, 1)
    const sw = Math.max(1, Math.round(bmp.width * scale))
    const sh = Math.max(1, Math.round(bmp.height * scale))
    const probe = document.createElement('canvas')
    probe.width = sw
    probe.height = sh
    const pctx = probe.getContext('2d', { willReadFrequently: true })
    if (!pctx) return untouched
    pctx.drawImage(bmp, 0, 0, sw, sh)
    const { data } = pctx.getImageData(0, 0, sw, sh)

    let minX = sw
    let minY = sh
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (data[(y * sw + x) * 4 + 3] > 16) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return untouched
    if (minX <= 1 && minY <= 1 && maxX >= sw - 2 && maxY >= sh - 2) return untouched

    const pad = Math.round(Math.max(bmp.width, bmp.height) * padFrac)
    const sx = Math.max(0, Math.floor(minX / scale) - pad)
    const sy = Math.max(0, Math.floor(minY / scale) - pad)
    const ex = Math.min(bmp.width, Math.ceil((maxX + 1) / scale) + pad)
    const ey = Math.min(bmp.height, Math.ceil((maxY + 1) / scale) + pad)
    const out = document.createElement('canvas')
    out.width = Math.max(1, ex - sx)
    out.height = Math.max(1, ey - sy)
    const octx = out.getContext('2d')
    if (!octx) return untouched
    octx.drawImage(bmp, sx, sy, out.width, out.height, 0, 0, out.width, out.height)
    return { blob: await canvasToBlob(out), offsetX: sx, offsetY: sy }
  } finally {
    bmp.close()
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'),
  )
}

import type { Category } from '../types'
import { backend, configureWasmThreads } from './backend'
import { cleanMask } from './mask'

/**
 * Pixel-level clothing parsing (SegFormer fine-tuned on clothes, run
 * in-browser via Transformers.js). Every pixel gets a label — Upper-clothes,
 * Pants, Dress, Hat, shoes, but also Face, Hair, arms and legs — so when the
 * user says "this is a top" we can extract exactly the garment's pixels and
 * nothing else. Skin and face are excluded by construction.
 */
const MODEL_ID = 'Xenova/segformer_b2_clothes'

// The clothes parser has no separate class for outerwear — a jacket is just
// "Upper-clothes" — so layers share the top's labels and are told apart by the
// category the user picks.
const CATEGORY_TO_LABELS: Record<Category, string[]> = {
  hat: ['Hat'],
  top: ['Upper-clothes', 'Dress'],
  layer: ['Upper-clothes', 'Dress', 'Scarf'],
  bottom: ['Pants', 'Skirt', 'Belt'],
  shoes: ['Left-shoe', 'Right-shoe'],
}

/** Every wearable class — used when the specific category comes up empty. */
const ANY_CLOTHING = [
  'Hat',
  'Upper-clothes',
  'Skirt',
  'Pants',
  'Dress',
  'Belt',
  'Left-shoe',
  'Right-shoe',
  'Scarf',
  'Bag',
]

interface MaskLike {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export interface SegmentedLabel {
  label: string
  mask: MaskLike
}

export type ClothesSegmentation = SegmentedLabel[]

type Segmenter = (url: string) => Promise<Array<{ label: string; mask: MaskLike }>>

let segmenterPromise: Promise<Segmenter> | null = null

function getSegmenter(onProgress?: (msg: string) => void): Promise<Segmenter> {
  segmenterPromise ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    configureWasmThreads(env)
    // WebGPU where it exists, threaded WASM otherwise. Left at the library
    // default this runs single-threaded on one CPU core.
    const { device, dtype } = await backend()
    const seg = await pipeline('image-segmentation', MODEL_ID, {
      device,
      dtype,
      progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
        if (p.status === 'progress' && typeof p.progress === 'number' && p.file?.endsWith('.onnx')) {
          onProgress?.(`Downloading garment AI… ${Math.round(p.progress)}%`)
        }
      },
    })
    return seg as unknown as Segmenter
  })()
  return segmenterPromise
}

/** Run clothes parsing on an image. Throws if the model can't load or run. */
export async function segmentClothes(
  blob: Blob,
  onProgress?: (msg: string) => void,
): Promise<ClothesSegmentation> {
  let segmenter: Segmenter
  try {
    segmenter = await getSegmenter(onProgress)
  } catch (err) {
    // Allow a retry on the next upload instead of caching the failure.
    segmenterPromise = null
    throw err
  }
  const url = URL.createObjectURL(blob)
  try {
    const out = await segmenter(url)
    return out.map(o => ({ label: o.label, mask: o.mask }))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Cut the pixels of one garment category out of the source image using the
 * parsed masks. Returns null when the category isn't meaningfully present
 * (caller should fall back to plain background removal).
 */
export async function composeGarment(
  source: Blob,
  seg: ClothesSegmentation,
  category: Category | 'any',
  minCoverage = 0.005,
): Promise<{ blob: Blob; coverage: number } | null> {
  const wanted = new Set(category === 'any' ? ANY_CLOTHING : CATEGORY_TO_LABELS[category])
  const masks = seg.filter(s => wanted.has(s.label)).map(s => s.mask)
  if (masks.length === 0) return null

  const mw = masks[0].width
  const mh = masks[0].height
  const union = new Uint8ClampedArray(mw * mh)
  for (const m of masks) {
    if (m.width !== mw || m.height !== mh) continue
    const stride = Math.max(1, Math.round(m.data.length / (mw * mh)))
    for (let i = 0; i < union.length; i++) {
      const v = m.data[i * stride]
      if (v > union[i]) union[i] = v
    }
  }
  // Tidy the mask before measuring it. The parser's raw output has a wide soft
  // edge (it runs at 512x512 and gets stretched up), plus speckle and pinholes;
  // cleaning first means a category whose only evidence is scattered
  // mis-labelled pixels reads as absent rather than as a tiny garment.
  cleanMask(union, mw, mh)

  let on = 0
  for (let i = 0; i < union.length; i++) if (union[i] > 127) on++
  const coverage = on / union.length
  if (coverage < minCoverage) return null

  const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = mw
    maskCanvas.height = mh
    const mctx = maskCanvas.getContext('2d')
    if (!mctx) return null
    const mdata = mctx.createImageData(mw, mh)
    for (let i = 0; i < union.length; i++) {
      mdata.data[i * 4] = 255
      mdata.data[i * 4 + 1] = 255
      mdata.data[i * 4 + 2] = 255
      mdata.data[i * 4 + 3] = union[i]
    }
    mctx.putImageData(mdata, 0, 0)

    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(maskCanvas, 0, 0, bmp.width, bmp.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'),
    )
    return { blob, coverage }
  } finally {
    bmp.close()
  }
}

import { backend, configureWasmThreads } from './backend'

/**
 * Alpha-matte refinement (ViTMatte, run in-browser via Transformers.js).
 *
 * The clothes parser predicts its mask on a fixed 512x512 grid, so on a phone
 * photo that mask is upscaled several times over before it ever touches the
 * pixels. `mask.ts` collapses the resulting halo at mask resolution, which
 * removes the background bleed but can't invent detail that was never
 * predicted — knit edges, loose threads and the gap under a collar all stay
 * blocky, because the underlying grid is coarse.
 *
 * ViTMatte is the standard fix: give it the photo plus a trimap (definitely
 * foreground / definitely background / unsure) and it solves for a real alpha
 * per pixel, at whatever resolution you hand it rather than on a fixed grid.
 * We already have a good coarse mask, and a trimap is just that mask with a
 * band of uncertainty painted around its edge — so this is a cheap add-on
 * rather than a second segmentation pass.
 *
 * The small checkpoint is ~28 MB quantized. This is a refinement, so every
 * failure path returns null and the caller keeps the coarse cutout.
 */

const MODEL_ID = 'Xenova/vitmatte-small-distinctions-646'

/**
 * Longest edge the matte runs at. ViTMatte works at whatever resolution it's
 * given, and a 48 MP phone photo decodes to ~190 MB of raw pixels before the
 * model allocates anything — enough to get the tab killed on a mid-range
 * Android. The alpha is composited back at full resolution afterwards; the
 * detail that matters lives in the transition band, which survives this.
 *
 * Kept a multiple of 32 so the processor's padding is a no-op and the model's
 * output lines up with its input without a crop step.
 */
const MAX_EDGE = 1024

/** Half-width, in pixels at MAX_EDGE, of the "unsure" band handed to the model. */
const BAND = 10

/** Coarse alpha above this is certainly garment; below `BG_AT`, certainly not. */
const FG_AT = 0.92
const BG_AT = 0.08

type Loaded = Awaited<ReturnType<typeof load>>

let loadPromise: Promise<Loaded> | null = null

async function load(onProgress?: (msg: string) => void) {
  const { AutoProcessor, VitMatteForImageMatting, RawImage, env } = await import(
    '@huggingface/transformers'
  )
  configureWasmThreads(env)
  const { device } = await backend()
  // q8 on both backends. Quantized weights have known silent-accuracy bugs on
  // WebGPU, so this started out as fp32-there / q8-on-WASM — but measuring the
  // two (see `npm run pipecheck`) showed q8 holding up: identical interior and
  // background alpha, an edge still ~5x tighter than the coarse mask, at a
  // quarter the download (28 MB vs 104 MB) and 6x the speed. The accuracy bug
  // doesn't reach this model, and fp32's cost isn't buying anything here.
  const dtype = 'q8'
  const opts = {
    device,
    dtype,
    progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
      if (p.status === 'progress' && typeof p.progress === 'number' && p.file?.endsWith('.onnx')) {
        onProgress?.(`Downloading edge refiner… ${Math.round(p.progress)}%`)
      }
    },
  } as const
  const processor = await AutoProcessor.from_pretrained(MODEL_ID, opts)
  const model = await VitMatteForImageMatting.from_pretrained(MODEL_ID, opts)
  return { processor, model, RawImage }
}

function loadModel(onProgress?: (msg: string) => void): Promise<Loaded> {
  loadPromise ??= load(onProgress).catch(err => {
    loadPromise = null // let the next upload retry rather than cache the failure
    throw err
  })
  return loadPromise
}

/** Working size for the matte: fits inside MAX_EDGE, both axes multiples of 32. */
function workSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(MAX_EDGE / w, MAX_EDGE / h, 1)
  const round32 = (v: number) => Math.max(32, Math.round((v * scale) / 32) * 32)
  return { w: round32(w), h: round32(h) }
}

function draw(bmp: ImageBitmap, w: number, h: number): ImageData | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Widen the unsure region by `r` pixels. Separable (rows, then columns), which
 * turns an O(r²) neighbourhood scan into two O(r) passes — the difference
 * between a few milliseconds and a visible stall at this resolution.
 */
function dilate(flag: Uint8Array, w: number, h: number, r: number): void {
  const tmp = new Uint8Array(flag.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      let hit = 0
      for (let i = lo; i <= hi; i++) {
        if (flag[row + i]) {
          hit = 1
          break
        }
      }
      tmp[row + x] = hit
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(h - 1, y + r)
      let hit = 0
      for (let i = lo; i <= hi; i++) {
        if (tmp[i * w + x]) {
          hit = 1
          break
        }
      }
      flag[y * w + x] = hit
    }
  }
}

/**
 * Build the three-way trimap ViTMatte expects: 0 background, 128 unsure,
 * 255 foreground. The unsure band is the coarse mask's own transition, widened
 * so the model has room to place the true edge on either side of wherever the
 * coarse mask guessed it.
 */
function trimapFrom(alpha: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h
  const unsure = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const a = alpha[i] / 255
    if (a > BG_AT && a < FG_AT) unsure[i] = 1
  }
  dilate(unsure, w, h, BAND)

  const tri = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    tri[i] = unsure[i] ? 128 : alpha[i] >= 128 ? 255 : 0
  }
  return tri
}

/**
 * Refine a coarse cutout's edges.
 *
 * `source` is the original photo and `coarse` the cutout produced from it — they
 * must share dimensions, which they do because `composeGarment` draws the mask
 * onto the full-size image. Returns null whenever refinement isn't possible, in
 * which case the caller should keep the coarse cutout.
 */
export async function refineMatte(
  source: Blob,
  coarse: Blob,
  onProgress?: (msg: string) => void,
): Promise<Blob | null> {
  let srcBmp: ImageBitmap | null = null
  let coarseBmp: ImageBitmap | null = null
  try {
    srcBmp = await createImageBitmap(source, { imageOrientation: 'from-image' })
    coarseBmp = await createImageBitmap(coarse)
    if (srcBmp.width !== coarseBmp.width || srcBmp.height !== coarseBmp.height) return null

    const { w, h } = workSize(srcBmp.width, srcBmp.height)
    const srcData = draw(srcBmp, w, h)
    const coarseData = draw(coarseBmp, w, h)
    if (!srcData || !coarseData) return null

    const n = w * h
    const alpha = new Uint8ClampedArray(n)
    for (let i = 0; i < n; i++) alpha[i] = coarseData.data[i * 4 + 3]

    // An all-or-nothing mask has no transition band for the model to work on.
    let band = 0
    for (let i = 0; i < n; i++) {
      const a = alpha[i] / 255
      if (a > BG_AT && a < FG_AT) band++
    }
    if (band === 0) return null

    const tri = trimapFrom(alpha, w, h)

    onProgress?.('Refining the edges…')
    const { processor, model, RawImage } = await loadModel(onProgress)

    // RGB only — feeding the cutout's own alpha back in would bias the matte.
    const rgb = new Uint8ClampedArray(n * 3)
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = srcData.data[i * 4]
      rgb[i * 3 + 1] = srcData.data[i * 4 + 1]
      rgb[i * 3 + 2] = srcData.data[i * 4 + 2]
    }
    const image = new RawImage(rgb, w, h, 3)
    const trimap = new RawImage(tri, w, h, 1)

    const inputs = await (processor as unknown as (i: unknown, t: unknown) => Promise<unknown>)(
      image,
      trimap,
    )
    const { alphas } = (await model(inputs as never)) as unknown as {
      alphas: { dims: number[]; data: Float32Array }
    }

    // Turn the predicted alpha straight into a white RGBA stencil rather than
    // going via RawImage: `fromTensor` hands back a Uint8Array, and the canvas
    // ImageData constructor only accepts Uint8ClampedArray, so that route
    // throws before it ever reaches a blob.
    const ah = alphas.dims[alphas.dims.length - 2]
    const aw = alphas.dims[alphas.dims.length - 1]
    const stencil = document.createElement('canvas')
    stencil.width = aw
    stencil.height = ah
    const sctx = stencil.getContext('2d')
    if (!sctx) return null
    const stencilData = sctx.createImageData(aw, ah)
    for (let i = 0, n = aw * ah; i < n; i++) {
      stencilData.data[i * 4] = 255
      stencilData.data[i * 4 + 1] = 255
      stencilData.data[i * 4 + 2] = 255
      stencilData.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, alphas.data[i])) * 255)
    }
    sctx.putImageData(stencilData, 0, 0)

    // The matte ran downscaled; paint it back over the full-resolution photo so
    // the saved garment keeps its original pixels, only better cut out.
    return await upscaleOnto(srcBmp, stencil)
  } catch (err) {
    // Refinement is optional, so this is never fatal — but a silent null is
    // impossible to diagnose from a bug report, and the failure modes here
    // (model download blocked, backend out of memory) are ones we'd want to
    // hear about.
    console.warn('[matte] edge refinement unavailable, keeping coarse cutout', err)
    return null
  } finally {
    srcBmp?.close()
    coarseBmp?.close()
  }
}

/** Composite the refined alpha back onto the full-resolution source. */
async function upscaleOnto(src: ImageBitmap, stencil: HTMLCanvasElement): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(stencil, 0, 0, src.width, src.height)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'),
  )
}

import type { FaceDetector } from '@mediapipe/tasks-vision'

// Pinned to the installed @mediapipe/tasks-vision version so the CDN wasm
// fileset matches the bundled JS API.
const MEDIAPIPE_VERSION = '0.10.14'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

let detectorPromise: Promise<FaceDetector> | null = null

function getDetector(): Promise<FaceDetector> {
  detectorPromise ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    )
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.35,
    })
  })()
  return detectorPromise
}

export interface FaceEraseResult {
  blob: Blob
  faces: number
  /** False when detection itself couldn't run (e.g. model fetch failed). */
  ok: boolean
}

/**
 * Detect faces (on-device) and erase them to transparency with an expanded
 * ellipse. Returns the original blob untouched when no face is found.
 */
export async function eraseFaces(blob: Blob): Promise<FaceEraseResult> {
  let bmp: ImageBitmap | null = null
  try {
    const detector = await getDetector()
    bmp = await createImageBitmap(blob)
    const { detections } = detector.detect(bmp)
    const boxes = detections
      .map(d => d.boundingBox)
      .filter((b): b is NonNullable<typeof b> => !!b)
    if (boxes.length === 0) return { blob, faces: 0, ok: true }

    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { blob, faces: 0, ok: false }
    ctx.drawImage(bmp, 0, 0)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
    for (const b of boxes) {
      // Erase the whole head, not just a face oval: clear a widened column
      // from the top of the image down to the chin, finished with an ellipse
      // so the cut bottom is rounded instead of a hard shelf. This takes
      // hair with it and avoids the "blob hole" look.
      const cx = b.originX + b.width / 2
      const chinY = b.originY + b.height * 1.02
      const halfW = b.width * 1.35
      ctx.fillRect(cx - halfW, 0, halfW * 2, Math.max(0, chinY))
      ctx.beginPath()
      ctx.ellipse(cx, chinY, halfW, b.height * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    const out = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(o => (o ? resolve(o) : reject(new Error('Canvas export failed'))), 'image/png'),
    )
    return { blob: out, faces: boxes.length, ok: true }
  } catch {
    // Allow a retry on the next upload instead of caching the failure.
    detectorPromise = null
    return { blob, faces: 0, ok: false }
  } finally {
    bmp?.close()
  }
}

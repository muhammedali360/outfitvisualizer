import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import type { Category } from '../types'

const MEDIAPIPE_VERSION = '0.10.14'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

// MediaPipe pose landmark indices.
const LEFT_EAR = 7
const RIGHT_EAR = 8
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_HIP = 23
const RIGHT_HIP = 24

let landmarkerPromise: Promise<PoseLandmarker> | null = null

function getLandmarker(): Promise<PoseLandmarker> {
  landmarkerPromise ??= (async () => {
    const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    )
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
      numPoses: 1,
    })
  })()
  return landmarkerPromise
}

export interface PosePoint {
  x: number
  y: number
  visibility: number
}

export interface PoseResult {
  points: PosePoint[]
  width: number
  height: number
}

/** Detect the person's pose (on-device). Returns null when none is found. */
export async function detectPose(blob: Blob): Promise<PoseResult | null> {
  let bmp: ImageBitmap | null = null
  try {
    const landmarker = await getLandmarker()
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    const res = landmarker.detect(bmp)
    const first = res.landmarks[0]
    if (!first || first.length === 0) return null
    return {
      points: first.map(l => ({ x: l.x, y: l.y, visibility: l.visibility ?? 1 })),
      width: bmp.width,
      height: bmp.height,
    }
  } catch {
    landmarkerPromise = null
    return null
  } finally {
    bmp?.close()
  }
}

/**
 * How many degrees the garment is tilted in the photo, judged by the body
 * line it hangs from: shoulders for tops, hips for bottoms, ears for hats.
 * Returns null when the relevant landmarks aren't confidently visible.
 */
export function garmentTilt(pose: PoseResult, category: Category): number | null {
  const pair =
    category === 'top' || category === 'layer'
      ? [LEFT_SHOULDER, RIGHT_SHOULDER]
      : category === 'bottom'
        ? [LEFT_HIP, RIGHT_HIP]
        : category === 'hat'
          ? [LEFT_EAR, RIGHT_EAR]
          : null
  if (!pair) return null
  const a = pose.points[pair[0]]
  const b = pose.points[pair[1]]
  if (!a || !b || a.visibility < 0.6 || b.visibility < 0.6) return null
  const dx = (b.x - a.x) * pose.width
  const dy = (b.y - a.y) * pose.height
  if (Math.abs(dx) < 1) return null
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (deg > 90) deg -= 180
  if (deg < -90) deg += 180
  return deg
}

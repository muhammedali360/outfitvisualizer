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

/** The landmark pair defining the line a category's garment hangs from. */
function hangPair(category: Category): [number, number] | null {
  if (category === 'top' || category === 'layer') return [LEFT_SHOULDER, RIGHT_SHOULDER]
  if (category === 'bottom') return [LEFT_HIP, RIGHT_HIP]
  if (category === 'hat') return [LEFT_EAR, RIGHT_EAR]
  return null
}

/** Both endpoints of that line in source pixels, when both are confident. */
function hangPoints(
  pose: PoseResult,
  category: Category,
): { ax: number; ay: number; bx: number; by: number } | null {
  const pair = hangPair(category)
  if (!pair) return null
  const a = pose.points[pair[0]]
  const b = pose.points[pair[1]]
  if (!a || !b || a.visibility < 0.6 || b.visibility < 0.6) return null
  return {
    ax: a.x * pose.width,
    ay: a.y * pose.height,
    bx: b.x * pose.width,
    by: b.y * pose.height,
  }
}

/** A point on the wearer's body, in pixels of the photo it was detected in. */
export interface PoseAnchor {
  x: number
  y: number
}

/**
 * The midpoint of the body line the garment hangs from — the shoulder line for
 * tops, the waistband for bottoms — in source pixels.
 *
 * Normalization otherwise has to infer this from the cutout's own bounding box,
 * which assumes the garment's proportions are typical for its category. On a
 * worn photo that assumption breaks in exactly the cases you'd notice: sleeves
 * hanging alongside the torso widen the silhouette, an untucked hem stretches
 * it downwards, and the inferred hang line drifts. When there's a body in the
 * frame we can read the real line instead of guessing at it.
 */
export function poseAnchor(pose: PoseResult, category: Category): PoseAnchor | null {
  const p = hangPoints(pose, category)
  if (!p) return null
  return { x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2 }
}

/**
 * How many degrees the garment is tilted in the photo, judged by the body
 * line it hangs from: shoulders for tops, hips for bottoms, ears for hats.
 * Returns null when the relevant landmarks aren't confidently visible.
 */
export function garmentTilt(pose: PoseResult, category: Category): number | null {
  const p = hangPoints(pose, category)
  if (!p) return null
  const dx = p.bx - p.ax
  const dy = p.by - p.ay
  if (Math.abs(dx) < 1) return null
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (deg > 90) deg -= 180
  if (deg < -90) deg += 180
  return deg
}

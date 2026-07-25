/**
 * Cleanup for the raw masks the segmentation models emit.
 *
 * The clothes parser runs at a fixed 512x512 and its output is stretched back
 * up to the photo's native resolution — often a 6-8x upscale on a phone shot.
 * Bilinear filtering turns every garment edge into a wide, soft ramp, so
 * compositing the mask straight onto the photo drags a translucent halo of
 * background colour around the whole piece. The same upscale smears isolated
 * mis-segmented specks into visible blobs and leaves pinholes inside flat
 * areas of fabric.
 *
 * None of that is fixable by a better model — it's a resampling artefact — so
 * the mask gets three passes before it's used:
 *
 *   1. `sharpenAlpha`  collapse the soft ramp to a narrow transition (kills the halo)
 *   2. `dropSpecks`    remove connected components far smaller than the garment
 *   3. `fillHoles`     close interior gaps the parser left in the fabric
 *
 * All three run on the mask at its own resolution, which is small, so the whole
 * thing costs well under a millisecond.
 */

/** Alpha values at or above this count as "inside the garment" for analysis. */
const ON = 128

/**
 * Compress the alpha ramp so edges land in a couple of pixels instead of
 * dozens. Everything below `lo` is cut to fully transparent, everything above
 * `hi` to fully opaque, and the band between is remapped with a smoothstep so
 * the edge stays anti-aliased rather than becoming a jagged binary cut.
 *
 * `lo` is deliberately well above zero: the bottom of the ramp is almost
 * entirely background pixels bleeding inward, and that's exactly the halo.
 */
export function sharpenAlpha(data: Uint8ClampedArray, lo = 0.35, hi = 0.65): void {
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    const a = v / 255
    if (a <= lo) {
      lut[v] = 0
    } else if (a >= hi) {
      lut[v] = 255
    } else {
      const t = (a - lo) / (hi - lo)
      lut[v] = Math.round(255 * t * t * (3 - 2 * t))
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = lut[data[i]]
}

/**
 * Zero out connected components much smaller than the biggest one.
 *
 * Not "keep the largest" — a pair of shoes is legitimately two blobs of
 * similar size, and an open jacket can be parsed as two panels. Anything at
 * least `keepRatio` of the largest component survives; the rest is speckle.
 */
export function dropSpecks(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  keepRatio = 0.15,
): void {
  const n = width * height
  // 0 = not yet visited, -1 = background, >0 = component id.
  const label = new Int32Array(n)
  const sizes: number[] = [0] // index 0 unused so ids start at 1
  const stack = new Int32Array(n)

  for (let start = 0; start < n; start++) {
    if (label[start] !== 0) continue
    if (data[start] < ON) {
      label[start] = -1
      continue
    }
    const id = sizes.length
    let size = 0
    let sp = 0
    stack[sp++] = start
    label[start] = id
    while (sp > 0) {
      const p = stack[--sp]
      size++
      const x = p % width
      const y = (p / width) | 0
      // 8-connectivity: thin straps and seams often touch only diagonally.
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const q = ny * width + nx
          if (label[q] !== 0) continue
          if (data[q] < ON) {
            label[q] = -1
            continue
          }
          label[q] = id
          stack[sp++] = q
        }
      }
    }
    sizes.push(size)
  }

  if (sizes.length <= 2) return // one component (or none) — nothing to prune
  let largest = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > largest) largest = sizes[i]
  const min = largest * keepRatio
  for (let i = 0; i < n; i++) {
    const id = label[i]
    if (id > 0 && sizes[id] < min) data[i] = 0
  }
}

/**
 * Fill enclosed transparent regions. Background is whatever the border can
 * reach, so any remaining hole is surrounded by garment and is a parser miss —
 * a dark fold read as background, a gap between buttons — not a real gap.
 */
export function fillHoles(data: Uint8ClampedArray, width: number, height: number): void {
  const n = width * height
  const outside = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0

  const push = (p: number) => {
    if (outside[p] || data[p] >= ON) return
    outside[p] = 1
    stack[sp++] = p
  }

  for (let x = 0; x < width; x++) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    push(y * width)
    push(y * width + width - 1)
  }

  while (sp > 0) {
    const p = stack[--sp]
    const x = p % width
    const y = (p / width) | 0
    if (x > 0) push(p - 1)
    if (x < width - 1) push(p + 1)
    if (y > 0) push(p - width)
    if (y < height - 1) push(p + width)
  }

  for (let i = 0; i < n; i++) {
    if (data[i] < ON && !outside[i]) data[i] = 255
  }
}

/** Run the full cleanup in the order that matters. */
export function cleanMask(data: Uint8ClampedArray, width: number, height: number): void {
  sharpenAlpha(data)
  dropSpecks(data, width, height)
  fillHoles(data, width, height)
}

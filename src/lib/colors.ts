export interface ExtractedColor {
  hex: string
  name: string
}

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Colors that pair with basically anything in an outfit. */
const VERSATILE = new Set([
  'black',
  'white',
  'light gray',
  'gray',
  'charcoal',
  'beige',
  'cream',
  'brown',
  'navy',
  'olive',
])

export function isVersatile(name: string): boolean {
  return VERSATILE.has(name)
}

/**
 * Extract up to `max` dominant colors from an image. Pixels that are mostly
 * transparent (i.e. removed background) are ignored, so cutout images yield
 * the garment's true palette.
 */
export async function extractColors(blob: Blob, max = 3): Promise<ExtractedColor[]> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(64 / bmp.width, 64 / bmp.height, 1)
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const { data } = ctx.getImageData(0, 0, w, h)

  const bins = new Map<number, { r: number; g: number; b: number; n: number }>()
  let counted = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    let bin = bins.get(key)
    if (!bin) {
      bin = { r: 0, g: 0, b: 0, n: 0 }
      bins.set(key, bin)
    }
    bin.r += r
    bin.g += g
    bin.b += b
    bin.n++
    counted++
  }
  if (counted === 0) return [{ hex: '#8a8a8a', name: 'gray' }]

  const ranked = [...bins.values()]
    .map(bin => ({ r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n, n: bin.n }))
    .sort((a, b) => b.n - a.n)

  const picked: typeof ranked = []
  for (const c of ranked) {
    if (picked.length >= max) break
    // Secondary colors must cover a meaningful share of the garment.
    if (picked.length > 0 && c.n < counted * 0.06) break
    if (picked.some(p => rgbDist(p, c) < 60)) continue
    picked.push(c)
  }

  return picked.map(c => {
    const r = Math.round(c.r)
    const g = Math.round(c.g)
    const b = Math.round(c.b)
    return { hex: rgbToHex(r, g, b), name: nameColor(r, g, b) }
  })
}

export type PairKind = 'neutral' | 'match' | 'analogous' | 'complementary' | 'clash'

/**
 * Score how well two garment colors sit together (0–100), and classify the
 * relationship for human-readable explanations.
 */
export function pairHarmony(
  hexA: string,
  nameA: string,
  hexB: string,
  nameB: string,
): { score: number; kind: PairKind } {
  if (isVersatile(nameA) || isVersatile(nameB)) return { score: 82, kind: 'neutral' }
  const a = hexToHsl(hexA)
  const b = hexToHsl(hexB)
  const d = hueDistance(a.h, b.h)
  if (d <= 20) return { score: 88, kind: 'match' }
  if (d <= 50) return { score: 84, kind: 'analogous' }
  if (d >= 140) return { score: 74, kind: 'complementary' }
  return { score: 45, kind: 'clash' }
}

function rgbDist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return rgbToHsl(r, g, b)
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function nameColor(r: number, g: number, b: number): string {
  const { h, s, l } = rgbToHsl(r, g, b)
  if (l < 0.12) return 'black'
  if (l > 0.93 && s < 0.3) return 'white'
  if (s < 0.13) return l > 0.65 ? 'light gray' : l > 0.3 ? 'gray' : 'charcoal'
  if (h < 15 || h >= 345) return l < 0.3 ? 'maroon' : 'red'
  if (h < 45) {
    if (l > 0.75) return 'cream'
    if (l > 0.55 && s < 0.5) return 'beige'
    return l < 0.42 ? 'brown' : 'orange'
  }
  if (h < 65) return l < 0.5 ? 'olive' : 'yellow'
  if (h < 150) return l < 0.3 ? 'forest green' : 'green'
  if (h < 200) return 'teal'
  if (h < 250) return l < 0.3 ? 'navy' : 'blue'
  if (h < 290) return 'purple'
  return 'pink'
}

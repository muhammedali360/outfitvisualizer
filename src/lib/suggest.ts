import type { Category, Formality, Warmth, WardrobeItem } from '../types'
import { CATEGORY_LABELS } from '../types'
import { cap, pairHarmony } from './colors'

export interface ScoreContext {
  targetWarmth?: Warmth
  targetFormality?: Formality
}

export interface OutfitScore {
  total: number
  harmony: number
  formality: number
  weather: number | null
  verdict: string
  reasons: string[]
  warnings: string[]
}

export function tier(n: number): 'good' | 'ok' | 'bad' {
  return n >= 85 ? 'good' : n >= 65 ? 'ok' : 'bad'
}

export function targetWarmthForTemp(tempC: number): Warmth {
  return tempC >= 21 ? 1 : tempC >= 11 ? 2 : 3
}

export function scoreOutfit(items: WardrobeItem[], ctx: ScoreContext = {}): OutfitScore {
  const reasons = new Set<string>()
  const warnings = new Set<string>()

  // Color harmony: compare each pair of garments by their dominant color.
  const colored = items.filter(i => i.colors.length > 0)
  let harmony = 78
  if (colored.length >= 2) {
    let sum = 0
    let pairs = 0
    let allNeutral = true
    for (let a = 0; a < colored.length; a++) {
      for (let b = a + 1; b < colored.length; b++) {
        const A = colored[a]
        const B = colored[b]
        const res = pairHarmony(A.colors[0], A.colorNames[0], B.colors[0], B.colorNames[0])
        sum += res.score
        pairs++
        if (res.kind !== 'neutral') allNeutral = false
        const la = CATEGORY_LABELS[A.category]
        const lb = CATEGORY_LABELS[B.category]
        if (res.kind === 'clash') {
          warnings.add(`The ${A.colorNames[0]} ${la} and ${B.colorNames[0]} ${lb} fight on the color wheel.`)
        } else if (res.kind === 'complementary') {
          reasons.add(`${cap(A.colorNames[0])} against ${B.colorNames[0]} is a bold, complementary contrast.`)
        } else if (res.kind === 'analogous') {
          reasons.add(`${cap(A.colorNames[0])} and ${B.colorNames[0]} are neighbors on the color wheel — easy pairing.`)
        } else if (res.kind === 'match' && A.colorNames[0] === B.colorNames[0]) {
          reasons.add(`Matching ${A.colorNames[0]} tones tie the look together.`)
        }
      }
    }
    harmony = Math.round(sum / pairs)
    if (allNeutral) reasons.add('All-neutral palette — everything goes with everything.')
  }

  // Cohesion: pieces should sit at a similar level of formality.
  const fs = items.map(i => i.formality)
  const spread = Math.max(...fs) - Math.min(...fs)
  let formality = spread === 0 ? 100 : spread === 1 ? 74 : 38
  if (spread >= 2) warnings.add('Mixes very casual and dressy pieces — pick a lane.')
  else if (spread === 0 && fs[0] === 3) reasons.add('Consistently dressy — a polished look.')
  else if (spread === 0 && fs[0] === 1) reasons.add('Relaxed from head to toe.')

  if (ctx.targetFormality) {
    const avg = fs.reduce((s, f) => s + f, 0) / fs.length
    const diff = avg - ctx.targetFormality
    const fit = Math.max(10, Math.round(100 - 40 * Math.abs(diff)))
    formality = Math.round((formality + fit) / 2)
    const occ = ctx.targetFormality === 1 ? 'laid-back' : ctx.targetFormality === 2 ? 'work' : 'dressy'
    if (diff <= -0.8) warnings.add(`Leans casual for a ${occ} occasion.`)
    if (diff >= 0.8) warnings.add(`A bit overdressed for a ${occ} day.`)
  }

  // Weather: judge the top and bottoms by weight against the day's target.
  let weather: number | null = null
  if (ctx.targetWarmth) {
    const core = items.filter(i => i.category === 'top' || i.category === 'bottom')
    if (core.length > 0) {
      const avg = core.reduce((s, i) => s + i.warmth, 0) / core.length
      const diff = avg - ctx.targetWarmth
      weather = Math.max(10, Math.round(100 - 45 * Math.abs(diff)))
      if (diff >= 1) warnings.add("You'll likely run hot in this today.")
      else if (diff <= -1) warnings.add('Might be chilly — consider warmer pieces.')
      else reasons.add('Weight-wise, right for the weather.')
    }
  }

  const parts: Array<[number, number]> = [
    [harmony, 0.5],
    [formality, 0.3],
  ]
  if (weather !== null) parts.push([weather, 0.2])
  const weightSum = parts.reduce((s, [, w]) => s + w, 0)
  const total = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / weightSum)

  const verdict =
    total >= 85
      ? 'Excellent — wear it with confidence.'
      : total >= 70
        ? 'Solid combo, no real notes.'
        : total >= 55
          ? 'Workable, with a few caveats.'
          : 'Hmm — maybe rethink this one.'

  return {
    total,
    harmony,
    formality,
    weather,
    verdict,
    reasons: [...reasons].slice(0, 4),
    warnings: [...warnings].slice(0, 3),
  }
}

export interface Suggestion {
  items: WardrobeItem[]
  selection: Partial<Record<Category, string>>
  score: OutfitScore
}

/**
 * Enumerate top × bottoms × shoes (hat optional) combinations and return the
 * best-scoring outfits, preferring variety across the picks.
 */
export function bestOutfits(all: WardrobeItem[], ctx: ScoreContext = {}, limit = 3): Suggestion[] {
  const by = (c: Category) => all.filter(i => i.category === c).slice(0, 25)
  const tops = by('top')
  const bottoms = by('bottom')
  const shoes = by('shoes')
  if (!tops.length || !bottoms.length || !shoes.length) return []
  const hats: Array<WardrobeItem | null> = [null, ...by('hat')]

  const combos: Suggestion[] = []
  for (const t of tops) {
    for (const b of bottoms) {
      for (const s of shoes) {
        for (const h of hats) {
          const items = h ? [h, t, b, s] : [t, b, s]
          const selection: Partial<Record<Category, string>> = {
            top: t.id,
            bottom: b.id,
            shoes: s.id,
          }
          if (h) selection.hat = h.id
          combos.push({ items, selection, score: scoreOutfit(items, ctx) })
        }
      }
    }
  }
  combos.sort((x, y) => y.score.total - x.score.total)

  // Greedy pick with a variety constraint, then backfill if too strict.
  const picked: Suggestion[] = []
  for (const c of combos) {
    if (picked.length >= limit) break
    if (picked.some(p => sharedCount(p, c) >= 3)) continue
    picked.push(c)
  }
  for (const c of combos) {
    if (picked.length >= limit) break
    if (!picked.includes(c)) picked.push(c)
  }
  return picked
}

function sharedCount(a: Suggestion, b: Suggestion): number {
  const ids = new Set(a.items.map(i => i.id))
  return b.items.filter(i => ids.has(i.id)).length
}

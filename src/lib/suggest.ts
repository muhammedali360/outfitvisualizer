import type { Category, Formality, Warmth, WardrobeItem } from '../types'
import { CATEGORY_LABELS, CORE_CATEGORIES } from '../types'
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

/**
 * How much warmth an outer layer adds on top of the top/bottom average —
 * a light shell counts for less than a parka.
 */
function layerBonus(layer: WardrobeItem): number {
  return 0.4 + 0.3 * (layer.warmth - 1)
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

  // Weather: judge the top and bottoms by weight against the day's target,
  // counting an outer layer as extra warmth on top of that.
  let weather: number | null = null
  const layer = items.find(i => i.category === 'layer')
  if (ctx.targetWarmth) {
    const core = items.filter(i => i.category === 'top' || i.category === 'bottom')
    if (core.length > 0) {
      const base = core.reduce((s, i) => s + i.warmth, 0) / core.length
      const effective = Math.min(3, base + (layer ? layerBonus(layer) : 0))
      const diff = effective - ctx.targetWarmth
      weather = Math.max(10, Math.round(100 - 45 * Math.abs(diff)))
      if (diff >= 1) warnings.add("You'll likely run hot in this today.")
      else if (diff <= -1) warnings.add('Might be chilly — consider warmer pieces.')
      else reasons.add('Weight-wise, right for the weather.')

      if (ctx.targetWarmth === 3 && !layer) {
        warnings.add('Cold out with nothing over the top — throw a jacket on.')
        weather = Math.max(10, weather - 15)
      } else if (ctx.targetWarmth === 1 && layer) {
        warnings.add('A jacket is probably too much for a day this warm.')
        weather = Math.max(10, weather - 12)
      } else if (ctx.targetWarmth === 3 && layer) {
        const which = layer.colorNames[0] ? `${cap(layer.colorNames[0])} jacket` : 'The jacket'
        reasons.add(`${which} on top covers you for the cold.`)
      }
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

/** Pieces the stylist may reach for: everything that isn't in the laundry. */
export function availableItems(all: WardrobeItem[]): WardrobeItem[] {
  return all.filter(i => !i.unavailable)
}

export function hasCoreWardrobe(all: WardrobeItem[]): boolean {
  return CORE_CATEGORIES.every(c => all.some(i => i.category === c))
}

/** Cap per category so the search stays instant on a large closet. */
const CORE_POOL = 12
const EXTRA_POOL = 10

function toSuggestion(items: WardrobeItem[], ctx: ScoreContext, score?: OutfitScore): Suggestion {
  const selection: Partial<Record<Category, string>> = {}
  for (const i of items) selection[i.category] = i.id
  return { items, selection, score: score ?? scoreOutfit(items, ctx) }
}

/**
 * Enumerate top × bottoms × shoes and return the best-scoring outfits,
 * preferring variety across the picks. Hats and outer layers are optional, so
 * rather than multiplying the search space by both they're fitted greedily to
 * each core combination and kept only when they improve the score.
 */
export function bestOutfits(all: WardrobeItem[], ctx: ScoreContext = {}, limit = 3): Suggestion[] {
  const wearable = availableItems(all)
  const by = (c: Category, n: number) => wearable.filter(i => i.category === c).slice(0, n)
  const tops = by('top', CORE_POOL)
  const bottoms = by('bottom', CORE_POOL)
  const shoes = by('shoes', CORE_POOL)
  if (!tops.length || !bottoms.length || !shoes.length) return []
  const hats = by('hat', EXTRA_POOL)
  const layers = by('layer', EXTRA_POOL)

  const combos: Suggestion[] = []
  for (const t of tops) {
    for (const b of bottoms) {
      for (const s of shoes) {
        let chosen: WardrobeItem[] = [t, b, s]
        let score = scoreOutfit(chosen, ctx)
        // Fit the optional pieces one group at a time, keeping the best
        // candidate only when it improves the score (a jacket on a cold day, a
        // hat that ties the palette together). One per group, so a combination
        // never ends up with two jackets.
        for (const extras of [layers, hats]) {
          let bestExtra: WardrobeItem | null = null
          let bestScore = score
          for (const extra of extras) {
            const cand = scoreOutfit([...chosen, extra], ctx)
            if (cand.total > bestScore.total) {
              bestExtra = extra
              bestScore = cand
            }
          }
          if (bestExtra) {
            chosen = [...chosen, bestExtra]
            score = bestScore
          }
        }
        combos.push(toSuggestion(chosen, ctx, score))
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

/**
 * A random-but-decent outfit: sample a handful of combinations, keep the
 * better half, and pick one at random. Wearing the top-scoring fit every time
 * would make the button pointless, wearing a truly random one would make it
 * useless.
 */
export function shuffleOutfit(
  all: WardrobeItem[],
  ctx: ScoreContext = {},
  avoid?: Partial<Record<Category, string>>,
): Suggestion | null {
  const wearable = availableItems(all)
  const pool = (c: Category) => wearable.filter(i => i.category === c)
  const tops = pool('top')
  const bottoms = pool('bottom')
  const shoes = pool('shoes')
  if (!tops.length || !bottoms.length || !shoes.length) return null
  const hats = pool('hat')
  const layers = pool('layer')
  const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]

  const samples: Suggestion[] = []
  for (let n = 0; n < 40; n++) {
    const items = [pick(tops), pick(bottoms), pick(shoes)]
    // Reach for a jacket when it's cold, a hat now and then.
    if (layers.length && (ctx.targetWarmth === 3 ? Math.random() < 0.8 : Math.random() < 0.25)) {
      items.push(pick(layers))
    }
    if (hats.length && Math.random() < 0.25) items.push(pick(hats))
    const s = toSuggestion(items, ctx)
    if (avoid && sameSelection(s.selection, avoid)) continue
    samples.push(s)
  }
  if (!samples.length) return null
  samples.sort((a, b) => b.score.total - a.score.total)
  const shortlist = samples.slice(0, Math.max(1, Math.ceil(samples.length / 2)))
  return pick(shortlist)
}

function sameSelection(
  a: Partial<Record<Category, string>>,
  b: Partial<Record<Category, string>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<Category>
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

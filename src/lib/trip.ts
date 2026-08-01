import type { Category, Formality, Warmth, WardrobeItem } from '../types'
import { CATEGORIES } from '../types'
import { availableItems, scoreOutfit, targetWarmthForTemp } from './suggest'
import { dayRange, daysBetween, todayKey } from './wear'
import { describeWeather, type DayForecast } from './weather'

/**
 * Packing a suitcase from the closet you already own.
 *
 * The received wisdom in every packing guide is the same one sentence: pack
 * for *combinations*, not for days. So this doesn't pick an outfit per day and
 * add them up — it picks the smallest set of pieces whose combinations cover
 * the trip, then deals those combinations across the days.
 *
 * Stylebook's published packing method (18 pieces → 20 looks in a carry-on)
 * states the constraint outright: "all of the tops should coordinate with all
 * of the bottoms you pack". That's a complete bipartite compatibility graph,
 * and it's what the selection below biases towards — a candidate that works
 * with everything already in the case beats one that merely adds the most
 * pairings.
 */

/**
 * Piece budgets, from the 54321 packing method (5 tops, 4 bottoms, 3 shoes,
 * 2 layers, 1 of each accessory) — a convention rather than a finding, but a
 * carry-on-sized one, and every source agrees on the shape if not the numbers.
 */
const MAX_TOPS = 5
const MAX_BOTTOMS = 4
const MAX_SHOES = 3
const MAX_LAYERS = 2
const MAX_HATS = 1

/** Same bar the rest of the app uses for "you'd actually wear this". */
const WORKS_AT = 70

/**
 * Once you're washing clothes there's no point packing another week of them.
 * Every generator that offers a laundry setting caps the outfit count this way.
 */
const LAUNDRY_CYCLE = 7

/** Open-Meteo's forecast reaches 16 days; past that we're guessing. */
export const FORECAST_HORIZON = 16

export interface Place {
  id: number
  name: string
  country: string
  region?: string
  latitude: number
  longitude: number
}

export function placeLabel(p: Place): string {
  return [p.name, p.region, p.country].filter(Boolean).join(', ')
}

/**
 * Look up a destination by name. Open-Meteo's geocoder, like its forecast, is
 * free and needs no key — and asking it about a city name tells it rather less
 * about the user than the browser's own geolocation would.
 */
export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
      `&count=6&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const results: unknown[] = Array.isArray(data?.results) ? data.results : []
    return results.flatMap(raw => {
      const r = raw as Record<string, unknown>
      if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return []
      if (typeof r.name !== 'string') return []
      return [
        {
          id: typeof r.id === 'number' ? r.id : Math.round(r.latitude * 1e4 + r.longitude),
          name: r.name,
          country: typeof r.country === 'string' ? r.country : '',
          region: typeof r.admin1 === 'string' ? r.admin1 : undefined,
          latitude: r.latitude,
          longitude: r.longitude,
        },
      ]
    })
  } catch {
    return []
  }
}

/**
 * The destination's forecast for the trip. Only the part of the trip inside
 * the forecast horizon comes back — days past it are the caller's problem to
 * label, rather than something to quietly invent a number for.
 */
export async function fetchTripForecast(
  place: Place,
  start: string,
  end: string,
): Promise<DayForecast[] | null> {
  const today = todayKey()
  const from = daysBetween(today, start) < 0 ? today : start
  const horizon = dayRange(today, FORECAST_HORIZON)[FORECAST_HORIZON - 1]
  const to = daysBetween(today, end) > FORECAST_HORIZON - 1 ? horizon : end
  if (daysBetween(from, to) < 0) return []
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&daily=temperature_2m_max,precipitation_probability_max,weather_code&timezone=auto` +
      `&start_date=${from}&end_date=${to}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const dates: unknown[] = data?.daily?.time ?? []
    const out: DayForecast[] = []
    for (let i = 0; i < dates.length; i++) {
      const temp = data.daily.temperature_2m_max?.[i]
      if (typeof dates[i] !== 'string' || typeof temp !== 'number') continue
      const [desc, emoji] = describeWeather(data.daily.weather_code?.[i])
      out.push({
        date: dates[i] as string,
        tempC: Math.round(temp),
        precipProb: Math.round(data.daily.precipitation_probability_max?.[i] ?? 0),
        desc,
        emoji,
      })
    }
    return out
  } catch {
    return null
  }
}

export interface TripSpec {
  /** Day keys, in order. */
  days: string[]
  forecast: Map<string, DayForecast>
  /** Used for days the forecast can't reach, and when there's no forecast at all. */
  fallbackWarmth: Warmth
  /** Narrow the case to one kind of trip, or null for a bit of everything. */
  occasion: Formality | null
  /** Doing a wash mid-trip caps how many combinations are worth packing. */
  laundry: boolean
}

export interface TripDayPlan {
  date: string
  forecast: DayForecast | null
  targetWarmth: Warmth
  items: WardrobeItem[]
  selection: Partial<Record<Category, string>>
  score: number
}

export interface PackingPlan {
  picks: WardrobeItem[]
  byCategory: Array<{ category: Category; items: WardrobeItem[] }>
  /** Top-and-bottom pairings among the packed pieces that hold up. */
  combinations: number
  /** How many distinct combinations the trip actually calls for. */
  needed: number
  days: TripDayPlan[]
  notes: string[]
  /** True when every packed top works with every packed bottom. */
  fullyMixable: boolean
}

function pairWorks(a: WardrobeItem, b: WardrobeItem): boolean {
  return scoreOutfit([a, b]).total >= WORKS_AT
}

/** How many distinct outfits a trip of this length actually needs. */
export function outfitsNeeded(dayCount: number, laundry: boolean): number {
  return Math.max(1, laundry ? Math.min(dayCount, LAUNDRY_CYCLE) : dayCount)
}

/** The warmth each day of the trip calls for. */
function warmthFor(spec: TripSpec, date: string): Warmth {
  const f = spec.forecast.get(date)
  return f ? targetWarmthForTemp(f.tempC) : spec.fallbackWarmth
}

/**
 * Pieces that suit the trip. A garment earns its place in the case if it's the
 * right weight for at least one day — packing for the average of a trip that
 * swings from 5°C to 22°C leaves you wrong on both ends.
 */
function poolFor(items: WardrobeItem[], spec: TripSpec, category: Category): WardrobeItem[] {
  const warmths = new Set(spec.days.map(d => warmthFor(spec, d)))
  return items.filter(i => {
    if (i.category !== category) return false
    if (spec.occasion !== null && Math.abs(i.formality - spec.occasion) > 1) return false
    if (category === 'hat' || category === 'shoes') return true
    return [...warmths].some(w => Math.abs(i.warmth - w) <= 1)
  })
}

/**
 * Grow the case one piece at a time, always taking whichever top or pair of
 * bottoms adds the most new working combinations — and preferring, on a tie,
 * the one that works with *everything* already packed. That preference is the
 * whole trick: a case where all the tops go with all the bottoms is worth more
 * than one with the same number of pairings scattered across incompatible
 * pieces, because you can get dressed in the dark.
 */
function selectCore(
  tops: WardrobeItem[],
  bottoms: WardrobeItem[],
  needed: number,
): { tops: WardrobeItem[]; bottoms: WardrobeItem[]; pairs: number; exhausted: boolean } {
  if (!tops.length || !bottoms.length) {
    return { tops: [], bottoms: [], pairs: 0, exhausted: true }
  }

  // Seed with the best-scoring pairing in the wardrobe, so the case is built
  // around something that definitely works.
  let bestSeed: [WardrobeItem, WardrobeItem] | null = null
  let bestScore = -1
  for (const t of tops) {
    for (const b of bottoms) {
      const s = scoreOutfit([t, b]).total
      if (s > bestScore) {
        bestScore = s
        bestSeed = [t, b]
      }
    }
  }
  if (!bestSeed) return { tops: [], bottoms: [], pairs: 0, exhausted: true }

  const chosenTops = [bestSeed[0]]
  const chosenBottoms = [bestSeed[1]]
  const countPairs = () => {
    let n = 0
    for (const t of chosenTops) for (const b of chosenBottoms) if (pairWorks(t, b)) n++
    return n
  }

  interface Candidate {
    item: WardrobeItem
    side: 'top' | 'bottom'
    gain: number
    complete: boolean
  }

  // Set when the case stops growing because nothing left in the closet goes
  // with what's already packed, rather than because it hit the piece budget.
  // The two are very different problems and want different advice.
  let exhausted = false
  let pairs = countPairs()
  while (pairs < needed) {
    const candidates: Candidate[] = []
    const consider = (item: WardrobeItem, side: 'top' | 'bottom') => {
      const against = side === 'top' ? chosenBottoms : chosenTops
      const gain = against.filter(other => pairWorks(item, other)).length
      if (gain > 0) candidates.push({ item, side, gain, complete: gain === against.length })
    }

    const roomForTop = chosenTops.length < MAX_TOPS
    const roomForBottom = chosenBottoms.length < MAX_BOTTOMS
    // Out of room is not the same as out of options — only the latter is the
    // closet's fault, and only the latter earns the "nothing else goes with
    // this" note.
    if (!roomForTop && !roomForBottom) break

    if (roomForTop) for (const t of tops) if (!chosenTops.includes(t)) consider(t, 'top')
    if (roomForBottom) for (const b of bottoms) if (!chosenBottoms.includes(b)) consider(b, 'bottom')
    if (!candidates.length) {
      exhausted = true
      break
    }

    // Completeness first, then raw gain — Stylebook's "all the tops should
    // coordinate with all the bottoms" made into a tie-break.
    candidates.sort(
      (a, b) => Number(b.complete) - Number(a.complete) || b.gain - a.gain,
    )
    const chosen = candidates[0]
    if (chosen.side === 'top') chosenTops.push(chosen.item)
    else chosenBottoms.push(chosen.item)
    pairs = countPairs()
  }

  return { tops: chosenTops, bottoms: chosenBottoms, pairs, exhausted }
}

/**
 * Pick the extras. These don't multiply the outfit count — swapping shoes
 * isn't a new outfit — so they're chosen for coverage: something for each level
 * of dressiness in the case, and something warm enough for the coldest day.
 */
function selectExtras(
  pool: WardrobeItem[],
  core: WardrobeItem[],
  max: number,
  needWarmth: Warmth | null,
): WardrobeItem[] {
  const picked: WardrobeItem[] = []
  const formalities = [...new Set(core.map(i => i.formality))].sort()

  for (const f of formalities) {
    if (picked.length >= max) break
    const match = pool
      .filter(i => !picked.includes(i) && Math.abs(i.formality - f) <= 1)
      .sort((a, b) => Math.abs(a.formality - f) - Math.abs(b.formality - f))[0]
    if (match) picked.push(match)
  }

  // The one thing a packing list can get wrong in a way that actually hurts:
  // nothing warm enough for the coldest day.
  if (needWarmth !== null && picked.every(i => i.warmth < needWarmth)) {
    const warm = pool
      .filter(i => !picked.includes(i) && i.warmth >= needWarmth)
      .sort((a, b) => b.warmth - a.warmth)[0]
    if (warm) {
      if (picked.length >= max) picked.pop()
      picked.push(warm)
    }
  }

  return picked.slice(0, max)
}

/** Stable identity for a combination, so the same fit isn't dealt twice. */
function signature(sel: Partial<Record<Category, string>>): string {
  return CATEGORIES.map(c => sel[c] ?? '').join('|')
}

/**
 * Build the case, then deal its combinations across the days — best fit for
 * each day's weather, preferring one not already worn earlier in the trip.
 */
export function planTrip(all: WardrobeItem[], spec: TripSpec): PackingPlan | null {
  const wearable = availableItems(all)
  const needed = outfitsNeeded(spec.days.length, spec.laundry)

  const core = selectCore(
    poolFor(wearable, spec, 'top'),
    poolFor(wearable, spec, 'bottom'),
    needed,
  )
  if (!core.tops.length || !core.bottoms.length) return null

  const coreItems = [...core.tops, ...core.bottoms]
  const coldest = spec.days.reduce<Warmth>(
    (w, d) => (warmthFor(spec, d) > w ? warmthFor(spec, d) : w),
    1,
  )
  const shoes = selectExtras(poolFor(wearable, spec, 'shoes'), coreItems, MAX_SHOES, null)
  const layers =
    coldest >= 2
      ? selectExtras(poolFor(wearable, spec, 'layer'), coreItems, MAX_LAYERS, coldest)
      : []
  const wet = spec.days.some(d => (spec.forecast.get(d)?.precipProb ?? 0) >= 50)
  const hats = wet ? selectExtras(poolFor(wearable, spec, 'hat'), coreItems, MAX_HATS, null) : []

  const picks = [...core.tops, ...core.bottoms, ...layers, ...shoes, ...hats]

  // Deal the days.
  const used = new Set<string>()
  const days: TripDayPlan[] = spec.days.map(date => {
    const targetWarmth = warmthFor(spec, date)
    const ctx = { targetWarmth, targetFormality: spec.occasion ?? undefined }
    let best: TripDayPlan | null = null
    let bestFresh: TripDayPlan | null = null

    for (const t of core.tops) {
      for (const b of core.bottoms) {
        for (const s of shoes.length ? shoes : [null]) {
          let items = [t, b, ...(s ? [s] : [])]
          let score = scoreOutfit(items, ctx).total
          // Layers and hats are optional, so try each and keep it only if it
          // actually improves the day — a jacket in a heatwave shouldn't be
          // packed onto the plan just because it's in the case.
          for (const extras of [layers, hats]) {
            let bestExtra: WardrobeItem | null = null
            let bestScore = score
            for (const extra of extras) {
              const cand = scoreOutfit([...items, extra], ctx).total
              if (cand > bestScore) {
                bestExtra = extra
                bestScore = cand
              }
            }
            if (bestExtra) {
              items = [...items, bestExtra]
              score = bestScore
            }
          }
          const selection: Partial<Record<Category, string>> = {}
          for (const i of items) selection[i.category] = i.id
          const plan: TripDayPlan = {
            date,
            forecast: spec.forecast.get(date) ?? null,
            targetWarmth,
            items,
            selection,
            score,
          }
          if (!best || score > best.score) best = plan
          if (!used.has(signature(selection)) && (!bestFresh || score > bestFresh.score)) {
            bestFresh = plan
          }
        }
      }
    }
    const chosen = bestFresh ?? best!
    used.add(signature(chosen.selection))
    return chosen
  })

  // A case holding one top and one pair of bottoms trivially satisfies "every
  // top works with every bottom", which is true and worthless. Claiming it
  // would congratulate someone whose case couldn't grow.
  const fullyMixable =
    core.pairs >= 2 && core.pairs === core.tops.length * core.bottoms.length

  const notes: string[] = []
  notes.push(
    `${core.tops.length} top${core.tops.length === 1 ? '' : 's'} and ${core.bottoms.length} pair${core.bottoms.length === 1 ? '' : 's'} of bottoms make ${core.pairs} combination${core.pairs === 1 ? '' : 's'} — ${core.pairs >= needed ? 'enough for' : 'short of'} the ${needed} the trip calls for.`,
  )
  if (core.pairs < needed && core.exhausted) {
    // The interesting case: the case is short not because we ran out of room
    // but because nothing else in the closet goes with what's already in it.
    notes.push(
      "The case stopped there because nothing else in your closet goes with what's in it — this is a wardrobe that doesn't mix, not a suitcase that's full.",
    )
  } else if (fullyMixable) {
    notes.push('Every top in the case works with every pair of bottoms, so nothing can go wrong.')
  } else if (core.pairs >= 2) {
    notes.push(
      "Not everything in the case goes with everything else — the day-by-day plan below only ever pairs the combinations that do.",
    )
  }
  if (spec.laundry && spec.days.length > LAUNDRY_CYCLE) {
    notes.push(
      `Packed for ${LAUNDRY_CYCLE} days on the assumption you'll do a wash — untick that and it packs for all ${spec.days.length}.`,
    )
  }
  if (coldest === 3 && layers.length === 0) {
    notes.push("It gets cold enough to want a jacket and there isn't one in your closet to pack.")
  }
  if (wet && hats.length === 0) {
    notes.push('Rain on the forecast — worth throwing something for your head in.')
  }

  const byCategory = CATEGORIES.map(category => ({
    category,
    items: picks.filter(i => i.category === category),
  })).filter(g => g.items.length > 0)

  return {
    picks,
    byCategory,
    combinations: core.pairs,
    needed,
    days,
    notes,
    fullyMixable,
  }
}

/** The packing list as plain text, for a notes app or a message to yourself. */
export function packingListText(plan: PackingPlan, title: string): string {
  const lines = [title, '']
  for (const group of plan.byCategory) {
    for (const item of group.items) lines.push(`[ ] ${item.name}`)
  }
  lines.push('', `${plan.picks.length} pieces · ${plan.combinations} combinations`)
  return lines.join('\n')
}

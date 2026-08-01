import type { Category, DayPlan, Formality, Warmth, WardrobeItem } from '../types'
import { CATEGORY_LABELS, FORMALITY_LABELS, WARMTH_LABELS } from '../types'
import { availableItems, scoreOutfit } from './suggest'
import { wearStats } from './wear'

/**
 * What the closet can't do yet, and what one more piece would fix.
 *
 * The formula every capsule-wardrobe calculator uses — tops × bottoms × shoes
 * × (layers + 1) — is arithmetic in search of a model. It assumes every top
 * goes with every bottom, and multiplying by shoes treats swapping sneakers
 * for loafers as a whole new outfit, which inflates the headline three to five
 * times over. So nothing here multiplies. We count the top-and-bottom pairings
 * that actually score as wearable, and everything else is expressed against
 * that.
 *
 * The recommendation engine is greedy marginal gain — for each piece you could
 * plausibly add, how many working pairings does it create? That's the shape
 * Hsiao & Grauman formalise for capsule selection (arXiv:1712.02662): the
 * objective is submodular, since adding a garment only ever expands the set of
 * possible outfits, which is what makes picking greedily near-optimal and
 * cheap.
 */

/**
 * The score at which a pairing counts as one you'd actually leave the house
 * in. Sits just above `scoreOutfit`'s "workable, with a few caveats" band, so
 * colour clashes and two-step formality jumps fall below it.
 */
export const WORKS_AT = 70

/** Stylists' rule of thumb, and only that — no study behind it. */
export const TOPS_PER_BOTTOM = 3
const RATIO_TOLERANCE: [number, number] = [2, 4]

/** Below this many partners a piece is effectively stranded in the closet. */
const STRANDED_AT = 2

export function pairWorks(a: WardrobeItem, b: WardrobeItem): boolean {
  return scoreOutfit([a, b]).total >= WORKS_AT
}

export interface Coverage {
  tops: number
  bottoms: number
  /** Pairings that score as wearable. */
  working: number
  /** Every top against every bottom, worked or not. */
  possible: number
  rate: number | null
}

/**
 * How much of the closet's raw combinatorial potential is real. `possible` is
 * every top against every bottom; `working` is how many of those clear the
 * wearable bar.
 */
export function coverage(items: WardrobeItem[]): Coverage {
  const tops = items.filter(i => i.category === 'top')
  const bottoms = items.filter(i => i.category === 'bottom')
  let working = 0
  for (const t of tops) for (const b of bottoms) if (pairWorks(t, b)) working++
  const possible = tops.length * bottoms.length
  return {
    tops: tops.length,
    bottoms: bottoms.length,
    working,
    possible,
    rate: possible > 0 ? working / possible : null,
  }
}

export interface Stranded {
  item: WardrobeItem
  /** How many pieces in the opposite core category it works with. */
  partners: number
  of: number
}

/**
 * Pieces that pair with almost nothing. The flip side of a gap: sometimes the
 * answer isn't "buy a bottom", it's "that one orange top is the problem".
 */
export function strandedPieces(items: WardrobeItem[]): Stranded[] {
  const tops = items.filter(i => i.category === 'top')
  const bottoms = items.filter(i => i.category === 'bottom')
  const out: Stranded[] = []
  const scan = (group: WardrobeItem[], against: WardrobeItem[]) => {
    if (against.length < 3) return // too small a sample to call anything stranded
    for (const item of group) {
      const partners = against.filter(other => pairWorks(item, other)).length
      if (partners < STRANDED_AT) out.push({ item, partners, of: against.length })
    }
  }
  scan(tops, bottoms)
  scan(bottoms, tops)
  return out.sort((a, b) => a.partners - b.partners || b.of - a.of)
}

/** A piece you don't own, described well enough to shop for. */
export interface Archetype {
  category: Category
  hex: string
  colorName: string
  formality: Formality
  warmth: Warmth
}

export interface Recommendation extends Archetype {
  /** Working pairings this piece would create that don't exist today. */
  gain: number
  /** Of those, how many rescue a piece that's currently stranded. */
  rescues: number
  /** How many counterpart pieces it was measured against. */
  of: number
  label: string
}

/**
 * A spread of plausible colours to shop for, named the same way the extractor
 * names garment colours so the harmony scoring treats them identically.
 */
const PALETTE: Array<[string, string]> = [
  ['#1a1a1a', 'black'],
  ['#3d3d3d', 'charcoal'],
  ['#8a8a8a', 'gray'],
  ['#cfcfcf', 'light gray'],
  ['#f2f0ec', 'white'],
  ['#efe4cd', 'cream'],
  ['#d3bd97', 'beige'],
  ['#6b4a2f', 'brown'],
  ['#26324f', 'navy'],
  ['#3d6db0', 'blue'],
  ['#6d7038', 'olive'],
  ['#4a8c56', 'green'],
  ['#2f7d80', 'teal'],
  ['#6b2431', 'maroon'],
  ['#c0392b', 'red'],
  ['#6b4c9a', 'purple'],
]

function asItem(a: Archetype): WardrobeItem {
  return {
    id: `archetype:${a.category}:${a.colorName}:${a.formality}:${a.warmth}`,
    name: describe(a),
    category: a.category,
    colors: [a.hex],
    colorNames: [a.colorName],
    warmth: a.warmth,
    formality: a.formality,
    image: new Blob(),
    createdAt: 0,
  }
}

export function describe(a: Archetype): string {
  const dressiness = FORMALITY_LABELS[a.formality].toLowerCase()
  const weight = WARMTH_LABELS[a.warmth].toLowerCase()
  return `${a.colorName} ${dressiness} ${weight} ${CATEGORY_LABELS[a.category]}`
}

/**
 * Close enough in colour that owning both is owning the same thing twice.
 * Measured in RGB rather than anything perceptual, which is coarse — but it
 * only ever has to separate "another black tee" from "a different black tee",
 * and the extractor's own palette is quantised more coarsely than this.
 */
const SAME_COLOR_AT = 52

function colorDistance(a: string, b: string): number {
  const [ra, ga, ba] = rgb(a)
  const [rb, gb, bb] = rgb(b)
  return Math.sqrt((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2)
}

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ]
}

/** Two pieces that do the same job in the same colour at the same weight. */
export function nearDuplicate(a: WardrobeItem, b: WardrobeItem): boolean {
  if (a.category !== b.category) return false
  if (a.formality !== b.formality) return false
  if (a.warmth !== b.warmth) return false
  if (!a.colors[0] || !b.colors[0]) return false
  return colorDistance(a.colors[0], b.colors[0]) <= SAME_COLOR_AT
}

export interface DuplicateCluster {
  items: WardrobeItem[]
  category: Category
  colorName: string
  formality: Formality
}

/**
 * Group pieces that are, for outfit purposes, the same piece. Not an
 * accusation — three black tees is a perfectly good way to live — but it's the
 * thing you want to know before buying a fourth.
 */
export function duplicateClusters(items: WardrobeItem[]): DuplicateCluster[] {
  const clusters: WardrobeItem[][] = []
  for (const item of items) {
    // Match against the cluster's first member so a chain of "close enough"
    // steps can't drift a cluster clean across the colour wheel.
    const home = clusters.find(c => nearDuplicate(c[0], item))
    if (home) home.push(item)
    else clusters.push([item])
  }
  return clusters
    .filter(c => c.length >= 2)
    .map(c => ({
      items: c,
      category: c[0].category,
      colorName: c[0].colorNames[0] ?? 'similar',
      formality: c[0].formality,
    }))
    .sort((a, b) => b.items.length - a.items.length)
}

/**
 * The pieces that would open up the most new pairings — ranked by how many
 * working combinations each would create.
 *
 * Only tops and bottoms are ranked here, and deliberately. A pairing is the
 * unit this module counts in, and only a top or a bottom can create one; shoes
 * and jackets layer onto pairings that already exist. Ranking them in the same
 * list would compare a garnish against a course — a neutral pair of shoes goes
 * with *every* working pairing, so it would win every time while telling you
 * nothing. What's missing in those categories is a different question, and
 * `coverageGaps` asks it.
 *
 * Anything close enough to something already hanging in the closet is dropped
 * before ranking. Without that the answer is always "buy a black one", because
 * a neutral goes with everything and so always wins on raw gain; what's
 * actually useful is the neutral you *haven't* got.
 */
export function recommendations(items: WardrobeItem[], limit = 4): Recommendation[] {
  const tops = items.filter(i => i.category === 'top')
  const bottoms = items.filter(i => i.category === 'bottom')

  const strandedIds = new Set(strandedPieces(items).map(s => s.item.id))
  const out: Recommendation[] = []

  for (const category of ['top', 'bottom'] as const) {
    const against = category === 'top' ? bottoms : tops
    if (against.length < 3) continue

    for (const [hex, colorName] of PALETTE) {
      for (const formality of [1, 2, 3] as Formality[]) {
        for (const warmth of [1, 2, 3] as Warmth[]) {
          const archetype: Archetype = { category, hex, colorName, formality, warmth }
          const candidate = asItem(archetype)
          if (items.some(owned => nearDuplicate(owned, candidate))) continue

          let gain = 0
          let rescues = 0
          for (const other of against) {
            if (!pairWorks(candidate, other)) continue
            gain++
            if (strandedIds.has(other.id)) rescues++
          }
          if (gain === 0) continue
          out.push({
            ...archetype,
            gain,
            rescues,
            of: against.length,
            label: describe(archetype),
          })
        }
      }
    }
  }

  // Rescues first: a piece that unstrands something you already own beats one
  // that just adds another combination to a piece already well served.
  out.sort((a, b) => b.rescues - a.rescues || b.gain - a.gain)

  // Never two of the same colour, and at most two per category — the raw top
  // four is four near-identical greys, which is technically correct and useless.
  const picked: Recommendation[] = []
  const perCategory = new Map<Category, number>()
  const seenColor = new Set<string>()
  for (const r of out) {
    if (picked.length >= limit) break
    if ((perCategory.get(r.category) ?? 0) >= 2 || seenColor.has(r.colorName)) continue
    perCategory.set(r.category, (perCategory.get(r.category) ?? 0) + 1)
    seenColor.add(r.colorName)
    picked.push(r)
  }
  return picked
}

export interface CoverageGap {
  category: Category
  /** Plain-English statement of what isn't covered. */
  text: string
}

/**
 * The extras — shoes and outer layers — asked as a coverage question rather
 * than a marginal-gain one: is there anything at all to finish the outfits you
 * can already make?
 *
 * Hats are left out. They're the one category nothing needs, so "you own no
 * hats" is an observation, not a gap.
 */
export function coverageGaps(items: WardrobeItem[]): CoverageGap[] {
  const core = items.filter(i => i.category === 'top' || i.category === 'bottom')
  if (core.length < 4) return []
  const out: CoverageGap[] = []

  for (const category of ['shoes', 'layer'] as const) {
    const owned = items.filter(i => i.category === category)
    for (const formality of [1, 2, 3] as Formality[]) {
      // Only worth flagging where you own a real cluster of core pieces at
      // that dressiness — one dressy shirt doesn't demand dress shoes.
      const demand = core.filter(i => i.formality === formality).length
      if (demand < 2) continue
      // Within one step is the same bar `scoreOutfit` uses for cohesion.
      const supply = owned.filter(i => Math.abs(i.formality - formality) <= 1).length
      if (supply > 0) continue
      out.push({
        category,
        text:
          category === 'shoes'
            ? `Nothing to put on your feet with your ${demand} ${FORMALITY_LABELS[formality].toLowerCase()} pieces.`
            : `No jacket that sits at ${FORMALITY_LABELS[formality].toLowerCase()}, and ${demand} of your pieces do.`,
      })
    }
  }

  // Layering is also about weight, and it's the one place the closet can leave
  // you actually cold rather than just mismatched.
  const layers = items.filter(i => i.category === 'layer')
  if (layers.length > 0 && !layers.some(l => l.warmth === 3)) {
    out.push({
      category: 'layer',
      text: 'Nothing warm to layer — every jacket you own is light or midweight.',
    })
  } else if (layers.length === 0) {
    out.push({ category: 'layer', text: 'No outer layer at all, for any weather.' })
  }

  return out
}

export interface OccasionGap {
  formality: Formality
  /** Share of the closet at this formality, 0–1. */
  closetShare: number
  /** Share of logged wears at this formality, 0–1. */
  wearShare: number
  /** wearShare − closetShare. Positive = you lean on it harder than you own it. */
  gap: number
}

/**
 * Where the closet and the calendar disagree. If half your wears are
 * smart-casual but only a fifth of your closet is, you're rotating the same
 * few pieces — and that's measured off your own log rather than lifted from
 * someone's published "40% work, 25% casual" allocation.
 */
export function occasionGaps(items: WardrobeItem[], days: DayPlan[]): OccasionGap[] | null {
  if (items.length === 0) return null
  const stats = wearStats(days)
  const byId = new Map(items.map(i => [i.id, i]))

  const closet = [0, 0, 0]
  for (const item of items) closet[item.formality - 1]++

  const wears = [0, 0, 0]
  let totalWears = 0
  for (const [id, stat] of stats) {
    const item = byId.get(id)
    if (!item) continue
    wears[item.formality - 1] += stat.count
    totalWears += stat.count
  }
  if (totalWears === 0) return null

  return ([1, 2, 3] as Formality[]).map(formality => {
    const closetShare = closet[formality - 1] / items.length
    const wearShare = wears[formality - 1] / totalWears
    return { formality, closetShare, wearShare, gap: wearShare - closetShare }
  })
}

export interface RatioCheck {
  tops: number
  bottoms: number
  ratio: number | null
  verdict: 'thin-on-tops' | 'balanced' | 'thin-on-bottoms'
}

/**
 * Tops per pair of bottoms against the stylists' 3:1 rule of thumb. A
 * convention repeated by everyone and demonstrated by nobody, so it's shown as
 * a comparison rather than a correction.
 */
export function ratioCheck(items: WardrobeItem[]): RatioCheck {
  const tops = items.filter(i => i.category === 'top').length
  const bottoms = items.filter(i => i.category === 'bottom').length
  if (bottoms === 0) return { tops, bottoms, ratio: null, verdict: 'balanced' }
  const ratio = tops / bottoms
  const verdict =
    ratio < RATIO_TOLERANCE[0]
      ? 'thin-on-tops'
      : ratio > RATIO_TOLERANCE[1]
        ? 'thin-on-bottoms'
        : 'balanced'
  return { tops, bottoms, ratio, verdict }
}

export interface GapReport {
  coverage: Coverage
  stranded: Stranded[]
  recommendations: Recommendation[]
  coverageGaps: CoverageGap[]
  duplicates: DuplicateCluster[]
  occasions: OccasionGap[] | null
  ratio: RatioCheck
  /** Pieces left out because they're in the wash. */
  skipped: number
}

/**
 * The whole analysis. Runs over what's actually wearable — judging the closet
 * on pieces that are in the laundry today would make the gaps look worse than
 * they are.
 */
export function analyzeGaps(all: WardrobeItem[], days: DayPlan[]): GapReport {
  const items = availableItems(all)
  return {
    coverage: coverage(items),
    stranded: strandedPieces(items),
    recommendations: recommendations(items),
    coverageGaps: coverageGaps(items),
    duplicates: duplicateClusters(items),
    occasions: occasionGaps(items, days),
    ratio: ratioCheck(items),
    skipped: all.length - items.length,
  }
}

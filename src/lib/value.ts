import type { Category, WardrobeItem } from '../types'
import { daysBetween, statFor, todayKey, type WearStat } from './wear'

/**
 * What each piece is actually costing you, and which ones have stopped
 * earning their keep.
 *
 * Every number here is either definitional (cost per wear is price ÷ wears) or
 * measured off this closet. Deliberately absent: the "$1 per wear" rule and
 * the "you wear 20% of your wardrobe 80% of the time" line. Both are repeated
 * everywhere with no traceable source, and the only published attempt to
 * measure the latter came out at 60%, not 80% — so rather than assert a number
 * at the user we measure theirs and show it back to them.
 */

/**
 * #30Wears — Livia Firth's 2015 Eco-Age campaign: before buying, ask whether
 * you'll wear it thirty times. An advocacy line rather than a study, but an
 * attributable one, and it needs no price, so it's the fallback progress
 * measure for pieces you never recorded a price for.
 */
export const WEAR_TARGET = 30

/** The window WRAP's unworn-clothing survey uses. */
export const UTILIZATION_WINDOW_DAYS = 365

/**
 * WRAP (2022) found 26% of the average UK adult's clothes had gone unworn for
 * a year, i.e. 74% utilization. The one benchmark here from a research
 * organisation rather than a blog, so it's the only one we quote at the user.
 */
export const WRAP_UTILIZATION = 0.74

/**
 * Pieces bought in the last few weeks aren't "unworn" in any meaningful sense,
 * so they sit out of the utilization rate rather than dragging it down.
 */
const SETTLING_IN_DAYS = 30

/** Never worn and owned this long — the shorter half of the 90/90 rule. */
const NEVER_WORN_DAYS = 90

/** Worn once upon a time, but not since. */
const STALE_DAYS = 180

export interface Money {
  currency: string
  amount: number
}

const CURRENCY_KEY = 'fitcheck-currency'

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'CHF', 'SEK'] as const

export function loadCurrency(): string {
  const saved = localStorage.getItem(CURRENCY_KEY)
  return saved && /^[A-Z]{3}$/.test(saved) ? saved : 'USD'
}

export function saveCurrency(code: string): void {
  localStorage.setItem(CURRENCY_KEY, code)
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      // Whole numbers for totals, cents for the small per-wear figures.
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Read a typed price. Blank means "no price", which is a real answer and not
 * the same as zero, so it comes back as undefined rather than 0.
 */
export function parsePrice(input: string): number | undefined {
  const cleaned = input.replace(/[^0-9.]/g, '')
  if (!cleaned) return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function hasPrice(item: WardrobeItem): boolean {
  return typeof item.price === 'number' && item.price > 0
}

/**
 * Price ÷ wears. Null when there's no price, and null when it's never been
 * worn — a piece worn zero times doesn't have an infinite cost per wear, it
 * has no cost per wear yet, and the two want saying differently.
 */
export function costPerWear(item: WardrobeItem, stat: WearStat): number | null {
  if (!hasPrice(item) || stat.count === 0) return null
  return item.price! / stat.count
}

/** How many more wears until this piece hits the #30Wears mark. */
export function wearsToTarget(stat: WearStat, target = WEAR_TARGET): number {
  return Math.max(0, target - stat.count)
}

/** How many more wears until the cost per wear drops under `target`. */
export function wearsToCostPerWear(item: WardrobeItem, stat: WearStat, target: number): number | null {
  if (!hasPrice(item) || target <= 0) return null
  return Math.max(0, Math.ceil(item.price! / target) - stat.count)
}

export interface ClosetValue {
  /** Summed price of every piece that has one. */
  total: number
  priced: number
  unpriced: number
  /** Total price divided by total logged wears across priced pieces. */
  blendedCostPerWear: number | null
}

/**
 * What the closet cost, counting only what you actually told us. Unpriced
 * pieces are left out rather than counted as free — a zero would quietly drag
 * every average down and put untagged pieces top of every "best value" list.
 */
export function closetValue(items: WardrobeItem[], stats: Map<string, WearStat>): ClosetValue {
  let total = 0
  let priced = 0
  let wears = 0
  for (const item of items) {
    if (!hasPrice(item)) continue
    total += item.price!
    priced++
    wears += statFor(stats, item.id).count
  }
  return {
    total,
    priced,
    unpriced: items.length - priced,
    blendedCostPerWear: wears > 0 ? total / wears : null,
  }
}

export interface Utilization {
  /** Pieces worn at least once inside the window. */
  worn: number
  /** Pieces old enough to judge. */
  eligible: number
  /** Pieces too recently added to count either way. */
  tooNew: number
  rate: number | null
}

/**
 * The share of the closet that saw daylight in the last year — the one stat
 * here with a real-world number to sit next to.
 */
export function utilization(
  items: WardrobeItem[],
  stats: Map<string, WearStat>,
  today = todayKey(),
): Utilization {
  const now = Date.now()
  let worn = 0
  let eligible = 0
  let tooNew = 0
  for (const item of items) {
    const ageDays = (now - item.createdAt) / 86_400_000
    if (ageDays < SETTLING_IN_DAYS) {
      tooNew++
      continue
    }
    eligible++
    const last = statFor(stats, item.id).lastWorn
    if (last && -daysBetween(today, last) <= UTILIZATION_WINDOW_DAYS) worn++
  }
  return { worn, eligible, tooNew, rate: eligible > 0 ? worn / eligible : null }
}

export interface Concentration {
  /** Size of the top fifth of the closet by wear count. */
  topCount: number
  /** Share of all logged wears those pieces account for, 0–1. */
  share: number
  totalWears: number
}

/**
 * How lopsided the wearing is: what fraction of wears the busiest fifth of the
 * closet accounts for. Measured, not asserted — the widely repeated "80% of
 * wears come from 20% of your clothes" has no source behind it.
 */
export function wearConcentration(
  items: WardrobeItem[],
  stats: Map<string, WearStat>,
): Concentration | null {
  if (items.length < 5) return null
  const counts = items.map(i => statFor(stats, i.id).count).sort((a, b) => b - a)
  const totalWears = counts.reduce((s, n) => s + n, 0)
  if (totalWears === 0) return null
  const topCount = Math.max(1, Math.round(counts.length * 0.2))
  const topWears = counts.slice(0, topCount).reduce((s, n) => s + n, 0)
  return { topCount, share: topWears / totalWears, totalWears }
}

export interface RankedItem {
  item: WardrobeItem
  stat: WearStat
  costPerWear: number
  /** 1 = the cheapest per wear in its category. */
  rank: number
  /** How many priced, worn pieces it's ranked against. */
  of: number
}

/**
 * Rank each priced piece by cost per wear *within its own category*. A winter
 * coat will always look expensive next to a t-shirt, so ranking across the
 * whole closet would just sort by category — the useful comparison is against
 * the other things that do the same job.
 */
export function costPerWearRanking(
  items: WardrobeItem[],
  stats: Map<string, WearStat>,
): RankedItem[] {
  const byCategory = new Map<Category, RankedItem[]>()
  for (const item of items) {
    const stat = statFor(stats, item.id)
    const cpw = costPerWear(item, stat)
    if (cpw === null) continue
    const list = byCategory.get(item.category) ?? []
    list.push({ item, stat, costPerWear: cpw, rank: 0, of: 0 })
    byCategory.set(item.category, list)
  }
  const out: RankedItem[] = []
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.costPerWear - b.costPerWear)
    list.forEach((entry, i) => {
      entry.rank = i + 1
      entry.of = list.length
      out.push(entry)
    })
  }
  return out
}

export type DeclutterReason = 'never-worn' | 'stale'

export interface DeclutterCandidate {
  item: WardrobeItem
  stat: WearStat
  reason: DeclutterReason
  /** Days since it was last worn, or since it was added if it never was. */
  idleDays: number
  /** What you'd be writing off, if a price was recorded. */
  sunkCost: number | null
}

export interface DeclutterReview {
  candidates: DeclutterCandidate[]
  /** Idle, but wrong weight for today — held back until its season comes round. */
  offSeason: number
}

/**
 * Pieces worth a second look, the reverse-hanger trick done properly: it works
 * on folded things, it knows the exact date, and it can tell an unworn piece
 * from one you simply haven't got round to.
 *
 * The blanket "haven't worn it in a year, bin it" rule is season-blind — a wool
 * coat idle through July is behaving exactly as intended. When we know what
 * today's weather calls for, pieces of the opposite weight are held back rather
 * than accused.
 */
export function declutterReview(
  items: WardrobeItem[],
  stats: Map<string, WearStat>,
  todayWarmth: 1 | 2 | 3 | null = null,
  today = todayKey(),
): DeclutterReview {
  const now = Date.now()
  const candidates: DeclutterCandidate[] = []
  let offSeason = 0

  for (const item of items) {
    const stat = statFor(stats, item.id)
    const ageDays = Math.floor((now - item.createdAt) / 86_400_000)
    let reason: DeclutterReason
    let idleDays: number
    if (stat.count === 0) {
      if (ageDays < NEVER_WORN_DAYS) continue
      reason = 'never-worn'
      idleDays = ageDays
    } else {
      idleDays = stat.lastWorn ? -daysBetween(today, stat.lastWorn) : ageDays
      if (idleDays < STALE_DAYS) continue
      reason = 'stale'
    }
    // Hats and shoes don't carry a meaningful weight, so only judge the
    // pieces whose warmth actually tracks the season.
    const seasonal = item.category === 'top' || item.category === 'bottom' || item.category === 'layer'
    if (todayWarmth !== null && seasonal && Math.abs(item.warmth - todayWarmth) >= 2) {
      offSeason++
      continue
    }
    candidates.push({
      item,
      stat,
      reason,
      idleDays,
      sunkCost: hasPrice(item) ? item.price! : null,
    })
  }

  candidates.sort(
    (a, b) =>
      Number(b.reason === 'never-worn') - Number(a.reason === 'never-worn') ||
      b.idleDays - a.idleDays ||
      (b.sunkCost ?? 0) - (a.sunkCost ?? 0),
  )
  return { candidates, offSeason }
}

/** "3 months", "2 years" — a rough duration for idle-time copy. */
export function humanDays(days: number): string {
  if (days < 45) return `${days} day${days === 1 ? '' : 's'}`
  const months = Math.round(days / 30)
  if (months < 18) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.round(days / 365)
  return `${years} year${years === 1 ? '' : 's'}`
}

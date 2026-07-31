import type { Category, DayPlan } from '../types'
import { CATEGORIES } from '../types'

/**
 * Calendar helpers and wear statistics. Everything is keyed by a local
 * `YYYY-MM-DD` string — deliberately not ISO/UTC, so a plan made at 11pm
 * doesn't land on tomorrow.
 */

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(): string {
  return dateKey(new Date())
}

/** Parse a day key back to a local Date at midday (immune to DST edges). */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export function shiftKey(key: string, days: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

/** Whole days from `a` to `b` (negative when `b` is in the past). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86_400_000)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Today", "Tomorrow", or "Thu 24 Jul". */
export function dayLabel(key: string, today = todayKey()): string {
  const delta = daysBetween(today, key)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  const d = parseKey(key)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** The next `count` day keys starting from `start`. */
export function dayRange(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftKey(start, i))
}

export interface WearStat {
  count: number
  /** Day key of the most recent wear, or null if never worn. */
  lastWorn: string | null
}

const EMPTY: WearStat = { count: 0, lastWorn: null }

/**
 * Roll the wear log up per item. Only days marked `worn` count — a plan for
 * next Tuesday isn't history yet.
 *
 * A wear is one *day* an item was worn, so a piece can only score once per
 * date however many slots it turns up in. Nothing in the app can file the same
 * id under two categories, but a hand-edited backup can, and cost per wear
 * divides by this number — a piece that quietly counted double would look
 * half as expensive as it is.
 */
export function wearStats(days: DayPlan[]): Map<string, WearStat> {
  const out = new Map<string, WearStat>()
  for (const day of days) {
    if (!day.worn) continue
    const seen = new Set<string>()
    for (const cat of CATEGORIES) {
      const id = day.items[cat]
      if (!id || seen.has(id)) continue
      seen.add(id)
      const prev = out.get(id) ?? { count: 0, lastWorn: null }
      prev.count++
      if (!prev.lastWorn || day.date > prev.lastWorn) prev.lastWorn = day.date
      out.set(id, prev)
    }
  }
  return out
}

export function statFor(stats: Map<string, WearStat>, id: string): WearStat {
  return stats.get(id) ?? EMPTY
}

/** "Worn 3× · 5 days ago" style summary for an item. */
export function wearSummary(stat: WearStat, today = todayKey()): string {
  if (stat.count === 0) return 'Never worn'
  const times = `Worn ${stat.count}×`
  if (!stat.lastWorn) return times
  const ago = -daysBetween(today, stat.lastWorn)
  const when =
    ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : ago < 30 ? `${ago} days ago` : `${Math.round(ago / 30)} mo ago`
  return `${times} · ${when}`
}

export function selectionIsEmpty(items: Partial<Record<Category, string>>): boolean {
  return Object.values(items).every(v => !v)
}

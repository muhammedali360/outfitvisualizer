import { useMemo, useState } from 'react'
import type { Category, DayPlan, Outfit, WardrobeItem } from '../types'
import { CATEGORIES } from '../types'
import { availableItems, bestOutfits, hasCoreWardrobe, targetWarmthForTemp, tier } from '../lib/suggest'
import type { Suggestion } from '../lib/suggest'
import { dayLabel, dayRange, daysBetween, selectionIsEmpty, todayKey } from '../lib/wear'
import type { DayForecast } from '../lib/weather'

const WEEK = 7

export type Selection = Partial<Record<Category, string>>

/**
 * The week ahead: one row per day, with that day's forecast, the outfit
 * planned for it and — once the day arrives — whether it was actually worn.
 * Wearing is logged here and in the studio; both write the same day record.
 */
export default function Planner({
  items,
  urls,
  outfits,
  days,
  forecast,
  weatherPending,
  studioSelection,
  onSetDay,
  onClearDay,
  onToggleWorn,
  onOpenInStudio,
  onGoWardrobe,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  outfits: Outfit[]
  days: DayPlan[]
  forecast: DayForecast[] | null
  weatherPending: boolean
  studioSelection: Selection
  onSetDay: (date: string, sel: Selection) => void
  onClearDay: (date: string) => void
  onToggleWorn: (date: string) => void
  onOpenInStudio: (sel: Selection) => void
  onGoWardrobe: () => void
}) {
  const today = todayKey()
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)

  const keys = useMemo(() => dayRange(today, WEEK), [today])
  const planByDate = useMemo(() => new Map(days.map(d => [d.date, d])), [days])
  const forecastByDate = useMemo(
    () => new Map((forecast ?? []).map(f => [f.date, f])),
    [forecast],
  )
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  const ready = hasCoreWardrobe(availableItems(items))
  const plannedCount = keys.filter(k => {
    const p = planByDate.get(k)
    return p && !selectionIsEmpty(p.items)
  }).length

  function warmthFor(date: string) {
    const f = forecastByDate.get(date)
    return f ? targetWarmthForTemp(f.tempC) : undefined
  }

  function picksFor(date: string, limit = 3): Suggestion[] {
    return bestOutfits(items, { targetWarmth: warmthFor(date) }, limit)
  }

  // Searching the wardrobe is the expensive part of this screen, so only do it
  // for the day whose picker is actually open — and only when its inputs move.
  const openPicks = useMemo(
    () => (openDay && ready ? picksFor(openDay) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openDay, ready, items, forecastByDate],
  )

  /**
   * Fill every empty day in the week with a suggestion for that day's weather,
   * skipping combinations already used earlier in the week so you don't get
   * the same fit five days running.
   */
  function planWeek() {
    if (planning) return
    setPlanning(true)
    // Yield once so the button can paint its busy state before the search.
    setTimeout(() => {
      try {
        const used = new Set<string>()
        for (const k of keys) {
          const existing = planByDate.get(k)
          if (existing && !selectionIsEmpty(existing.items)) {
            used.add(signature(existing.items))
          }
        }
        for (const k of keys) {
          const existing = planByDate.get(k)
          if (existing && !selectionIsEmpty(existing.items)) continue
          const options = picksFor(k, 6)
          const fresh = options.find(o => !used.has(signature(o.selection))) ?? options[0]
          if (!fresh) continue
          used.add(signature(fresh.selection))
          onSetDay(k, fresh.selection)
        }
      } finally {
        setPlanning(false)
      }
    }, 0)
  }

  if (items.length === 0) {
    return (
      <div className="empty-hero">
        <div className="empty-emoji">🗓️</div>
        <h2>Nothing to plan with yet</h2>
        <p>Add a few pieces to your wardrobe, then map out the week ahead.</p>
        <button className="btn primary" onClick={onGoWardrobe}>
          Go to wardrobe
        </button>
      </div>
    )
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>The week ahead</h1>
          <p className="sub">
            {plannedCount === 0
              ? 'Plan an outfit per day against the forecast — then log what you actually wore.'
              : `${plannedCount} of ${WEEK} days planned.`}
          </p>
        </div>
        <div className="head-actions">
          {ready && (
            <button className="btn primary" onClick={planWeek} disabled={planning}>
              {planning ? 'Planning…' : '✨ Plan the week'}
            </button>
          )}
        </div>
      </div>

      {weatherPending && <p className="sub">Checking the forecast near you…</p>}
      {!weatherPending && !forecast && (
        <p className="sub">
          No forecast available — planning still works, it just won't weigh the weather.
        </p>
      )}

      <div className="day-list">
        {keys.map(key => {
          const plan = planByDate.get(key)
          const sel = plan?.items ?? {}
          const empty = selectionIsEmpty(sel)
          const fc = forecastByDate.get(key)
          const isToday = key === today
          const pieces = CATEGORIES.map(c => sel[c])
            .filter((id): id is string => !!id)
            .map(id => itemById.get(id))
            .filter((i): i is WardrobeItem => !!i)

          return (
            <div key={key} className={isToday ? 'card day-row today' : 'card day-row'}>
              <div className="day-head">
                <div className="day-when">
                  <strong>{dayLabel(key, today)}</strong>
                  {fc && (
                    <span className="day-weather">
                      {fc.emoji} {fc.tempC}°C
                      {fc.precipProb >= 50 ? ` · ${fc.precipProb}% rain` : ''}
                    </span>
                  )}
                </div>
                {plan?.worn && <span className="worn-badge">✓ Worn</span>}
              </div>

              {empty ? (
                <div className="day-empty">
                  <span className="sub">Nothing planned.</span>
                </div>
              ) : (
                <div className="day-outfit">
                  {pieces.map(p => (
                    <img key={p.id} src={urls[p.id]} alt={p.name} title={p.name} />
                  ))}
                  <span className="day-names">{pieces.map(p => p.name).join(' · ')}</span>
                </div>
              )}

              <div className="day-actions">
                <button
                  className="btn ghost small"
                  onClick={() => setOpenDay(openDay === key ? null : key)}
                >
                  {openDay === key ? 'Close' : empty ? 'Plan this day' : 'Change'}
                </button>
                {!empty && (
                  <>
                    <button className="btn ghost small" onClick={() => onOpenInStudio(sel)}>
                      Open in studio
                    </button>
                    {daysBetween(today, key) <= 0 && (
                      <button
                        className={plan?.worn ? 'btn small worn' : 'btn ghost small'}
                        onClick={() => onToggleWorn(key)}
                      >
                        {plan?.worn ? '✓ Worn' : 'Mark worn'}
                      </button>
                    )}
                    <button className="btn ghost small" onClick={() => onClearDay(key)}>
                      Clear
                    </button>
                  </>
                )}
              </div>

              {openDay === key && (
                <DayPicker
                  date={key}
                  urls={urls}
                  outfits={outfits}
                  itemById={itemById}
                  studioSelection={studioSelection}
                  picks={openPicks}
                  onPick={sel2 => {
                    onSetDay(key, sel2)
                    setOpenDay(null)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DayPicker({
  date,
  urls,
  outfits,
  itemById,
  studioSelection,
  picks,
  onPick,
}: {
  date: string
  urls: Record<string, string>
  outfits: Outfit[]
  itemById: Map<string, WardrobeItem>
  studioSelection: Selection
  picks: Suggestion[]
  onPick: (sel: Selection) => void
}) {
  const studioReady = !selectionIsEmpty(studioSelection)
  return (
    <div className="day-picker">
      {picks.length > 0 && (
        <>
          <h3>Best for {dayLabel(date).toLowerCase()}</h3>
          <div className="pick-row">
            {picks.map((p, i) => (
              <button key={i} className="pick" onClick={() => onPick(p.selection)}>
                <span className="pick-thumbs">
                  {p.items.map(it => (
                    <img key={it.id} src={urls[it.id]} alt={it.name} />
                  ))}
                </span>
                <span className={`score-badge small ${tier(p.score.total)}`}>{p.score.total}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {outfits.length > 0 && (
        <>
          <h3>Saved outfits</h3>
          <div className="pick-row">
            {outfits.map(o => (
              <button key={o.id} className="pick" onClick={() => onPick({ ...o.items })}>
                <span className="pick-thumbs">
                  {CATEGORIES.map(c => {
                    const id = o.items[c]
                    return id && urls[id] ? <img key={c} src={urls[id]} alt="" /> : null
                  })}
                </span>
                <span className="pick-name">{o.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {studioReady && (
        <button className="btn ghost small" onClick={() => onPick({ ...studioSelection })}>
          Use what's in the studio (
          {CATEGORIES.map(c => studioSelection[c])
            .filter((id): id is string => !!id)
            .map(id => itemById.get(id)?.name)
            .filter(Boolean)
            .join(', ')}
          )
        </button>
      )}
    </div>
  )
}

/** Stable identity for a combination, used to keep the week varied. */
function signature(sel: Selection): string {
  return CATEGORIES.map(c => sel[c] ?? '').join('|')
}

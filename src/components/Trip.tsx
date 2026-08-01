import { useEffect, useMemo, useRef, useState } from 'react'
import type { Formality, WardrobeItem, Warmth } from '../types'
import { CATEGORY_ICONS, CATEGORY_LABELS_PLURAL } from '../types'
import {
  fetchTripForecast,
  FORECAST_HORIZON,
  packingListText,
  placeLabel,
  planTrip,
  searchPlaces,
  type Place,
} from '../lib/trip'
import { dayLabel, dayRange, daysBetween, todayKey } from '../lib/wear'
import type { DayForecast } from '../lib/weather'

const TRIP_KEY = 'fitcheck-trip'

/** How a day reads when there's no forecast to read it from. */
const FEEL_LABELS: Record<Warmth, string> = { 1: 'Hot', 2: 'Mild', 3: 'Cold' }
const MAX_NIGHTS = 30

interface SavedTrip {
  place: Place | null
  start: string
  end: string
  laundry: boolean
  occasion: Formality | null
  fallbackWarmth: Warmth
  packed: string[]
}

function loadTrip(): SavedTrip | null {
  try {
    const raw = localStorage.getItem(TRIP_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as SavedTrip
    if (typeof t?.start !== 'string' || typeof t?.end !== 'string') return null
    return { ...t, packed: Array.isArray(t.packed) ? t.packed : [] }
  } catch {
    return null
  }
}

/**
 * Pack a case out of the closet. The trip itself lives in localStorage rather
 * than the database — it's one working document, not a record worth backing up,
 * and the plan is recomputed from the closet each time so it never goes stale
 * against a wardrobe that's moved on.
 */
export default function Trip({
  items,
  urls,
  onGoWardrobe,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  onGoWardrobe: () => void
}) {
  const saved = useMemo(loadTrip, [])
  const today = todayKey()

  const [place, setPlace] = useState<Place | null>(saved?.place ?? null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [start, setStart] = useState(saved?.start ?? today)
  const [end, setEnd] = useState(saved?.end ?? dayRange(today, 5)[4])
  const [laundry, setLaundry] = useState(saved?.laundry ?? false)
  const [occasion, setOccasion] = useState<Formality | null>(saved?.occasion ?? null)
  const [fallbackWarmth, setFallbackWarmth] = useState<Warmth>(saved?.fallbackWarmth ?? 2)
  const [packed, setPacked] = useState<Set<string>>(new Set(saved?.packed ?? []))
  const [forecast, setForecast] = useState<DayForecast[] | null>(null)
  const [forecastState, setForecastState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [copied, setCopied] = useState(false)

  const length = Math.max(1, daysBetween(start, end) + 1)
  const days = useMemo(
    () => (length > MAX_NIGHTS ? [] : dayRange(start, length)),
    [start, length],
  )
  const tooLong = length > MAX_NIGHTS
  const backwards = daysBetween(start, end) < 0
  const beyondForecast = daysBetween(today, end) > FORECAST_HORIZON - 1

  useEffect(() => {
    localStorage.setItem(
      TRIP_KEY,
      JSON.stringify({
        place,
        start,
        end,
        laundry,
        occasion,
        fallbackWarmth,
        packed: [...packed],
      } satisfies SavedTrip),
    )
  }, [place, start, end, laundry, occasion, fallbackWarmth, packed])

  // Destination search, debounced so a typed city name isn't six requests.
  const searchTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      searchPlaces(search).then(found => {
        setResults(found)
        setSearching(false)
      })
    }, 350)
    return () => window.clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    if (!place || backwards || tooLong) return
    let cancelled = false
    setForecastState('loading')
    fetchTripForecast(place, start, end).then(f => {
      if (cancelled) return
      setForecast(f)
      setForecastState(f === null ? 'error' : 'idle')
    })
    return () => {
      cancelled = true
    }
  }, [place, start, end, backwards, tooLong])

  const plan = useMemo(() => {
    if (!days.length) return null
    return planTrip(items, {
      days,
      forecast: new Map((forecast ?? []).map(f => [f.date, f])),
      fallbackWarmth,
      occasion,
      laundry,
    })
  }, [items, days, forecast, fallbackWarmth, occasion, laundry])

  function togglePacked(id: string) {
    setPacked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copyList() {
    if (!plan) return
    const title = place
      ? `${placeLabel(place)} · ${dayLabel(start, today)}–${dayLabel(end, today)}`
      : `Trip · ${length} day${length === 1 ? '' : 's'}`
    try {
      await navigator.clipboard.writeText(packingListText(plan, title))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the list is on screen either way.
    }
  }

  if (items.length === 0) {
    return (
      <div className="empty-hero">
        <div className="empty-emoji">🧳</div>
        <h2>Nothing to pack yet</h2>
        <p>Add some pieces to your wardrobe and this will build a case out of them.</p>
        <button className="btn primary" onClick={onGoWardrobe}>
          Go to wardrobe
        </button>
      </div>
    )
  }

  const packedCount = plan ? plan.picks.filter(p => packed.has(p.id)).length : 0

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Pack a case</h1>
          <p className="sub">
            The fewest pieces that still cover the trip — chosen for how they combine, not one
            outfit per day.
          </p>
        </div>
        {plan && (
          <div className="head-actions">
            <button className="btn ghost small" onClick={copyList}>
              {copied ? '✓ Copied' : 'Copy list'}
            </button>
          </div>
        )}
      </div>

      <div className="card trip-form">
        <div className="field">
          <span className="label">Where to</span>
          {place ? (
            <div className="chip-row">
              <span className="chip active">📍 {placeLabel(place)}</span>
              <button
                className="btn ghost small"
                onClick={() => {
                  setPlace(null)
                  setForecast(null)
                  setSearch('')
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search a city — optional, it only sets the weather"
              />
              {searching && <span className="sub">Looking…</span>}
              {results.length > 0 && (
                <div className="place-list">
                  {results.map(p => (
                    <button
                      key={p.id}
                      className="chip"
                      onClick={() => {
                        setPlace(p)
                        setResults([])
                        setSearch('')
                      }}
                    >
                      {placeLabel(p)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="trip-dates">
          <label className="field">
            <span className="label">Leaving</span>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Back</span>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
          </label>
        </div>

        <div className="field">
          <span className="label">Occasion</span>
          <div className="chip-row">
            <button
              className={occasion === null ? 'chip active' : 'chip'}
              onClick={() => setOccasion(null)}
            >
              A bit of everything
            </button>
            {(
              [
                [1, 'Casual'],
                [2, 'Work'],
                [3, 'Dressy'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                className={occasion === v ? 'chip active' : 'chip'}
                onClick={() => setOccasion(v)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {(!place || beyondForecast || forecastState === 'error') && (
          <div className="field">
            <span className="label">
              {place && beyondForecast ? 'Weather past the forecast' : 'Weather there'}
            </span>
            <div className="chip-row">
              {(
                [
                  [3, 'Cold'],
                  [2, 'Mild'],
                  [1, 'Hot'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  className={fallbackWarmth === v ? 'chip active' : 'chip'}
                  onClick={() => setFallbackWarmth(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            <span className="sub">
              {forecastState === 'error'
                ? "Couldn't reach the forecast — pick how it'll feel."
                : place && beyondForecast
                  ? `The forecast only reaches ${FORECAST_HORIZON} days out. Days past that use this.`
                  : 'Pick a destination for a real forecast, or just say how it will feel.'}
            </span>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={laundry} onChange={e => setLaundry(e.target.checked)} />
          I'll do a wash — pack for a week's worth of combinations, not the whole trip
        </label>
      </div>

      {backwards && <p className="notice error">You're back before you've left.</p>}
      {tooLong && (
        <p className="notice error">
          That's over {MAX_NIGHTS} days — past a month you're moving, not packing.
        </p>
      )}
      {forecastState === 'loading' && <p className="sub">Checking the weather there…</p>}

      {!backwards && !tooLong && !plan && (
        <div className="empty-hero">
          <div className="empty-emoji">🧺</div>
          <h2>Not enough to pack</h2>
          <p>
            A case needs at least one top and one pair of bottoms that suit the trip. Widen the
            occasion, or add more to the wardrobe.
          </p>
          <button className="btn primary" onClick={onGoWardrobe}>
            Go to wardrobe
          </button>
        </div>
      )}

      {plan && (
        <>
          <div className="card">
            <div className="coverage-head">
              <strong className="stat-value">{plan.picks.length}</strong>
              <span className="sub">
                pieces · {plan.combinations} combination{plan.combinations === 1 ? '' : 's'} ·{' '}
                {days.length} day{days.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="reasons">
              {plan.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="section-head tight">
              <h3>The case</h3>
              <span className="sub">
                {packedCount} of {plan.picks.length} packed
              </span>
            </div>
            {plan.byCategory.map(group => (
              <div key={group.category} className="pack-group">
                <div className="slot-label">
                  {CATEGORY_ICONS[group.category]} {CATEGORY_LABELS_PLURAL[group.category]}
                </div>
                <div className="pack-row">
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      className={packed.has(item.id) ? 'pack-item packed' : 'pack-item'}
                      onClick={() => togglePacked(item.id)}
                      title={packed.has(item.id) ? 'In the case' : 'Mark as packed'}
                    >
                      <img src={urls[item.id]} alt={item.name} />
                      <span>{item.name}</span>
                      {packed.has(item.id) && <i className="pack-tick">✓</i>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Day by day</h3>
            <p className="sub">
              Dealt from the case — best fit for each day's weather, and never the same
              combination twice while there's a fresh one left.
            </p>
            <div className="trip-days">
              {plan.days.map(d => (
                <div key={d.date} className="trip-day">
                  <div className="day-when">
                    <strong>{dayLabel(d.date, today)}</strong>
                    <span className="day-weather">
                      {d.forecast
                        ? `${d.forecast.emoji} ${d.forecast.tempC}°C${d.forecast.precipProb >= 50 ? ` · ${d.forecast.precipProb}% rain` : ''}`
                        : place
                          ? `Past the forecast · ${FEEL_LABELS[fallbackWarmth]}`
                          : FEEL_LABELS[fallbackWarmth]}
                    </span>
                  </div>
                  <div className="day-outfit">
                    {d.items.map(i => (
                      <img key={i.id} src={urls[i.id]} alt={i.name} title={i.name} />
                    ))}
                    <span className="day-names">{d.items.map(i => i.name).join(' · ')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

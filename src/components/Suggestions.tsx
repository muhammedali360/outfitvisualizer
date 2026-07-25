import { useMemo, useState } from 'react'
import type { Category, Formality, Warmth, WardrobeItem } from '../types'
import { availableItems, bestOutfits, hasCoreWardrobe, targetWarmthForTemp, tier } from '../lib/suggest'
import type { Weather } from '../lib/weather'

export type WeatherState = Weather | 'loading' | 'error'

export default function Suggestions({
  items,
  urls,
  weather,
  onWear,
  onGoWardrobe,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  weather: WeatherState
  onWear: (sel: Partial<Record<Category, string>>) => void
  onGoWardrobe: () => void
}) {
  const [warmthOverride, setWarmthOverride] = useState<Warmth | null>(null)
  const [occasion, setOccasion] = useState<Formality | null>(null)

  const live = typeof weather === 'object' ? weather : null
  const targetWarmth = warmthOverride ?? (live ? targetWarmthForTemp(live.tempC) : null)

  const suggestions = useMemo(
    () =>
      bestOutfits(
        items,
        {
          targetWarmth: targetWarmth ?? undefined,
          targetFormality: occasion ?? undefined,
        },
        3,
      ),
    [items, targetWarmth, occasion],
  )

  const wearable = useMemo(() => availableItems(items), [items])
  const haveCore = hasCoreWardrobe(wearable)
  const inLaundry = items.length - wearable.length

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Stylist</h1>
          <p className="sub">What to wear, straight from your own closet.</p>
        </div>
      </div>

      <div className="card today-card">
        <div className="today-head">
          <h2>Today</h2>
          {weather === 'loading' && <span className="sub">Checking the sky near you…</span>}
          {weather === 'error' && (
            <span className="sub">Couldn't get local weather — pick a vibe below.</span>
          )}
          {live && (
            <span className="today-weather">
              {live.emoji} {live.desc}, around {live.tempC}°C
            </span>
          )}
        </div>
        {live && live.precipProb >= 50 && (
          <p className="sub">☔ {live.precipProb}% chance of rain — a hat wouldn't hurt.</p>
        )}
        {inLaundry > 0 && (
          <p className="sub">
            🧺 Skipping {inLaundry} piece{inLaundry === 1 ? '' : 's'} in the laundry.
          </p>
        )}
        <div className="filters">
          <div className="chip-row">
            <span className="label">Feels</span>
            <button
              className={warmthOverride === null ? 'chip active' : 'chip'}
              onClick={() => setWarmthOverride(null)}
            >
              Auto
            </button>
            {(
              [
                [3, 'Cold'],
                [2, 'Mild'],
                [1, 'Hot'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                className={warmthOverride === v ? 'chip active' : 'chip'}
                onClick={() => setWarmthOverride(v)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="chip-row">
            <span className="label">Occasion</span>
            <button className={occasion === null ? 'chip active' : 'chip'} onClick={() => setOccasion(null)}>
              Any
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
      </div>

      {!haveCore ? (
        <div className="empty-hero">
          <div className="empty-emoji">🧦</div>
          <h2>The stylist needs more to work with</h2>
          <p>Add at least one top, one pair of bottoms, and some shoes — then come back for picks.</p>
          <button className="btn primary" onClick={onGoWardrobe}>
            Go to wardrobe
          </button>
        </div>
      ) : (
        <div className="suggestion-list">
          {suggestions.map((s, idx) => (
            <div key={idx} className="card suggestion-card">
              <div className="suggestion-head">
                <strong>{idx === 0 ? "Today's pick" : `Option ${idx + 1}`}</strong>
                <span className={`score-badge small ${tier(s.score.total)}`}>{s.score.total}</span>
              </div>
              <div className="suggestion-items">
                {s.items.map(i => (
                  <div key={i.id} className="suggestion-item">
                    <img src={urls[i.id]} alt={i.name} />
                    <span>{i.name}</span>
                  </div>
                ))}
              </div>
              <p className="verdict">{s.score.verdict}</p>
              {s.score.reasons.length > 0 && (
                <ul className="reasons">
                  {s.score.reasons.slice(0, 3).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {s.score.warnings.length > 0 && (
                <ul className="reasons warn">
                  {s.score.warnings.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              <button className="btn primary" onClick={() => onWear(s.selection)}>
                Try it on
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { Category, Outfit, Warmth, WardrobeItem } from '../types'
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS_PLURAL } from '../types'
import { availableItems, hasCoreWardrobe, scoreOutfit, shuffleOutfit, tier } from '../lib/suggest'
import Avatar from './Avatar'

const Avatar3D = lazy(() => import('./Avatar3D'))

type ViewMode = '2d' | '3d'
const VIEW_KEY = 'fitcheck-studio-view'

export default function OutfitBuilder({
  items,
  urls,
  selection,
  onChange,
  outfits,
  onSaveOutfit,
  onDeleteOutfit,
  onGoWardrobe,
  onWoreToday,
  wornToday,
  targetWarmth,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  selection: Partial<Record<Category, string>>
  onChange: (sel: Partial<Record<Category, string>>) => void
  outfits: Outfit[]
  onSaveOutfit: (outfit: Outfit) => void
  onDeleteOutfit: (id: string) => void
  onGoWardrobe: () => void
  onWoreToday: (sel: Partial<Record<Category, string>>) => void
  /** True when today's log already holds exactly this combination. */
  wornToday: boolean
  targetWarmth: Warmth | null
}) {
  const [outfitName, setOutfitName] = useState('')
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_KEY) === '3d' ? '3d' : '2d',
  )

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  const chosen = useMemo(
    () =>
      CATEGORIES.map(c => items.find(i => i.id === selection[c])).filter(
        (i): i is WardrobeItem => !!i,
      ),
    [items, selection],
  )

  const score = useMemo(() => (chosen.length >= 2 ? scoreOutfit(chosen) : null), [chosen])

  const images = useMemo(() => {
    const out: Partial<Record<Category, string>> = {}
    for (const c of CATEGORIES) {
      const id = selection[c]
      if (id && urls[id]) out[c] = urls[id]
    }
    return out
  }, [selection, urls])

  const canShuffle = useMemo(() => hasCoreWardrobe(availableItems(items)), [items])

  function toggle(cat: Category, id: string) {
    const next = { ...selection }
    if (next[cat] === id) delete next[cat]
    else next[cat] = id
    onChange(next)
  }

  function shuffle() {
    const next = shuffleOutfit(items, { targetWarmth: targetWarmth ?? undefined }, selection)
    if (next) onChange(next.selection)
  }

  if (items.length === 0) {
    return (
      <div className="empty-hero">
        <div className="empty-emoji">🪞</div>
        <h2>The studio is empty</h2>
        <p>Add a few pieces to your wardrobe first, then come back to dress the mannequin.</p>
        <button className="btn primary" onClick={onGoWardrobe}>
          Go to wardrobe
        </button>
      </div>
    )
  }

  return (
    <section className="studio">
      <div className="studio-left card">
        <div className="studio-controls">
          <div className="view-toggle">
            {(['2d', '3d'] as ViewMode[]).map(v => (
              <button
                key={v}
                className={view === v ? 'seg active' : 'seg'}
                onClick={() => setView(v)}
              >
                {v === '2d' ? '2-D' : '3-D'}
              </button>
            ))}
          </div>
          <button
            className="btn ghost small"
            onClick={shuffle}
            disabled={!canShuffle}
            title={
              canShuffle
                ? 'Random outfit, weighted toward the ones that actually work'
                : 'Needs a top, bottoms and shoes that are out of the laundry'
            }
          >
            🎲 Shuffle
          </button>
        </div>
        {view === '2d' ? (
          <Avatar images={images} showHints />
        ) : (
          <>
            <Suspense
              fallback={
                <div className="avatar3d-loading">
                  <span className="spinner" /> Loading 3-D…
                </div>
              }
            >
              <Avatar3D images={images} />
            </Suspense>
            <p className="sub hint-3d">Drag to spin · scroll or pinch to zoom</p>
          </>
        )}
      </div>

      <div className="studio-right">
        {CATEGORIES.map(cat => {
          const group = items.filter(i => i.category === cat)
          return (
            <div key={cat} className="slot-row">
              <div className="slot-label">
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS_PLURAL[cat]}
              </div>
              {group.length === 0 ? (
                <div className="sub">None yet — add some in the wardrobe.</div>
              ) : (
                <div className="thumb-row">
                  {group.map(item => {
                    const classes = ['thumb']
                    if (selection[cat] === item.id) classes.push('active')
                    if (item.unavailable) classes.push('dim')
                    return (
                      <button
                        key={item.id}
                        title={item.unavailable ? `${item.name} — in the laundry` : item.name}
                        className={classes.join(' ')}
                        onClick={() => toggle(cat, item.id)}
                      >
                        <img src={urls[item.id]} alt={item.name} />
                        {item.unavailable && <span className="thumb-flag">🧺</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {score && (
          <div className="card score-card">
            <div className="score-head">
              <div className={`score-badge ${tier(score.total)}`}>{score.total}</div>
              <div className="score-detail">
                <strong>{score.verdict}</strong>
                <div className="score-bars">
                  <ScoreBar label="Color" value={score.harmony} />
                  <ScoreBar label="Cohesion" value={score.formality} />
                </div>
              </div>
            </div>
            {score.reasons.length > 0 && (
              <ul className="reasons">
                {score.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {score.warnings.length > 0 && (
              <ul className="reasons warn">
                {score.warnings.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="save-row">
          <input
            value={outfitName}
            onChange={e => setOutfitName(e.target.value)}
            placeholder={`Outfit ${outfits.length + 1}`}
          />
          <button
            className="btn primary"
            disabled={chosen.length < 2}
            title={chosen.length < 2 ? 'Pick at least two pieces first' : undefined}
            onClick={() => {
              onSaveOutfit({
                id: crypto.randomUUID(),
                name: outfitName.trim() || `Outfit ${outfits.length + 1}`,
                items: { ...selection },
                createdAt: Date.now(),
              })
              setOutfitName('')
            }}
          >
            Save outfit
          </button>
        </div>

        <button
          className={wornToday ? 'btn wide worn' : 'btn wide'}
          disabled={chosen.length < 2}
          title={
            chosen.length < 2
              ? 'Pick at least two pieces first'
              : 'Log this as what you wore today — it feeds your wear history'
          }
          onClick={() => onWoreToday({ ...selection })}
        >
          {wornToday ? '✓ Logged as worn today' : '👕 I wore this today'}
        </button>

        {outfits.length > 0 && (
          <div className="saved-outfits">
            <h3>Saved outfits</h3>
            <div className="outfit-list">
              {outfits.map(o => (
                <div key={o.id} className="outfit-chip">
                  <button className="outfit-load" title="Load this outfit" onClick={() => onChange({ ...o.items })}>
                    <span className="outfit-thumbs">
                      {CATEGORIES.map(c => {
                        const id = o.items[c]
                        return id && urls[id] ? <img key={c} src={urls[id]} alt="" /> : null
                      })}
                    </span>
                    {o.name}
                  </button>
                  <button className="icon-btn" title="Delete outfit" onClick={() => onDeleteOutfit(o.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-bar">
      <span>{label}</span>
      <div className="bar">
        <div className={`fill ${tier(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

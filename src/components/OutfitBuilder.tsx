import { useMemo, useState } from 'react'
import type { Category, Outfit, WardrobeItem } from '../types'
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS_PLURAL } from '../types'
import { scoreOutfit, tier } from '../lib/suggest'
import Avatar from './Avatar'

export default function OutfitBuilder({
  items,
  urls,
  selection,
  onChange,
  outfits,
  onSaveOutfit,
  onDeleteOutfit,
  onGoWardrobe,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  selection: Partial<Record<Category, string>>
  onChange: (sel: Partial<Record<Category, string>>) => void
  outfits: Outfit[]
  onSaveOutfit: (outfit: Outfit) => void
  onDeleteOutfit: (id: string) => void
  onGoWardrobe: () => void
}) {
  const [outfitName, setOutfitName] = useState('')

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

  function toggle(cat: Category, id: string) {
    const next = { ...selection }
    if (next[cat] === id) delete next[cat]
    else next[cat] = id
    onChange(next)
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
        <Avatar images={images} showHints />
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
                  {group.map(item => (
                    <button
                      key={item.id}
                      title={item.name}
                      className={selection[cat] === item.id ? 'thumb active' : 'thumb'}
                      onClick={() => toggle(cat, item.id)}
                    >
                      <img src={urls[item.id]} alt={item.name} />
                    </button>
                  ))}
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

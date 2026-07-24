import { useState } from 'react'
import type { WardrobeItem } from '../types'
import { CATEGORIES, CATEGORY_LABELS_PLURAL, FORMALITY_LABELS, WARMTH_LABELS } from '../types'
import UploadModal from './UploadModal'

export default function Wardrobe({
  items,
  urls,
  onAdd,
  onDelete,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  onAdd: (item: WardrobeItem) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Your wardrobe</h1>
          <p className="sub">Snap your clothes, cut them out, build fits.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Add a piece
        </button>
      </div>

      {items.length === 0 && (
        <div className="empty-hero">
          <div className="empty-emoji">🧥</div>
          <h2>Nothing in the closet yet</h2>
          <p>
            Upload a photo of a garment — laid flat on the bed works great. Fit Check cuts out the
            background, reads its colors, and files it in your virtual closet.
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Upload your first piece
          </button>
        </div>
      )}

      {CATEGORIES.map(cat => {
        const group = items.filter(i => i.category === cat)
        if (!group.length) return null
        return (
          <div key={cat} className="cat-group">
            <h3>{CATEGORY_LABELS_PLURAL[cat]}</h3>
            <div className="card-grid">
              {group.map(item => (
                <div key={item.id} className="item-card">
                  <button className="del" title="Remove from wardrobe" onClick={() => onDelete(item.id)}>
                    ✕
                  </button>
                  <div className="item-img">
                    <img src={urls[item.id]} alt={item.name} />
                  </div>
                  <div className="item-name">{item.name}</div>
                  <div className="item-meta">
                    <span className="dots">
                      {item.colors.slice(0, 3).map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span>
                      {WARMTH_LABELS[item.warmth]} · {FORMALITY_LABELS[item.formality]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {adding && (
        <UploadModal
          onClose={() => setAdding(false)}
          onSave={async item => {
            await onAdd(item)
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}

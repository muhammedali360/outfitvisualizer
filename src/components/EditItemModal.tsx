import { useState } from 'react'
import type { Category, Formality, Warmth, WardrobeItem } from '../types'
import {
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  FORMALITY_LABELS,
  WARMTH_LABELS,
} from '../types'
import { cap, extractColors } from '../lib/colors'
import { trimTransparent } from '../lib/image'
import { frameToStandard } from '../lib/normalize'
import { statFor, wearSummary, type WearStat } from '../lib/wear'

/**
 * Fix up a piece after the fact — rename it, re-file it, mark it as being in
 * the laundry. Re-filing also re-frames the cutout to the new category's
 * standard aspect and re-reads its colors, so a mis-tagged jacket doesn't stay
 * stuck in a top-shaped frame.
 */
export default function EditItemModal({
  item,
  url,
  stats,
  onSave,
  onDelete,
  onClose,
}: {
  item: WardrobeItem
  url?: string
  stats: Map<string, WearStat>
  onSave: (item: WardrobeItem) => void | Promise<void>
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState<Category>(item.category)
  const [warmth, setWarmth] = useState<Warmth>(item.warmth)
  const [formality, setFormality] = useState<Formality>(item.formality)
  const [unavailable, setUnavailable] = useState(!!item.unavailable)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const stat = statFor(stats, item.id)

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      let { image, colors, colorNames } = item
      if (category !== item.category) {
        image = await trimTransparent(image)
          .catch(() => image)
          .then(t => frameToStandard(t, category).catch(() => t))
        const fresh = await extractColors(image).catch(() => [])
        if (fresh.length) {
          colors = fresh.map(c => c.hex)
          colorNames = fresh.map(c => c.name)
        }
      }
      await onSave({
        ...item,
        name: name.trim() || item.name,
        category,
        warmth,
        formality,
        unavailable,
        image,
        colors,
        colorNames,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Edit piece</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="upload-body">
          <div className="upload-preview">
            <div className="preview-frame">{url && <img src={url} alt={item.name} />}</div>
            <div className="sub">{wearSummary(stat)}</div>
          </div>

          <div className="upload-form">
            <div className="field">
              <span className="label">Name</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={item.name} />
            </div>
            <div className="field">
              <span className="label">What is it?</span>
              <div className="chip-row">
                {CATEGORIES.map(c => (
                  <button
                    key={c}
                    className={category === c ? 'chip active' : 'chip'}
                    onClick={() => setCategory(c)}
                  >
                    {CATEGORY_ICONS[c]} {cap(CATEGORY_LABELS[c])}
                  </button>
                ))}
              </div>
              {category !== item.category && (
                <span className="sub">Saving re-frames the cutout for its new slot.</span>
              )}
            </div>
            <div className="field">
              <span className="label">Warmth</span>
              <div className="chip-row">
                {([1, 2, 3] as const).map(w => (
                  <button
                    key={w}
                    className={warmth === w ? 'chip active' : 'chip'}
                    onClick={() => setWarmth(w)}
                  >
                    {WARMTH_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">Vibe</span>
              <div className="chip-row">
                {([1, 2, 3] as const).map(f => (
                  <button
                    key={f}
                    className={formality === f ? 'chip active' : 'chip'}
                    onClick={() => setFormality(f)}
                  >
                    {FORMALITY_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={unavailable}
                onChange={e => setUnavailable(e.target.checked)}
              />
              🧺 In the laundry — keep it out of suggestions
            </label>

            <button className="btn primary wide" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {confirmDelete ? (
              <div className="chip-row">
                <button className="btn danger small" onClick={() => onDelete(item.id)}>
                  Delete for good
                </button>
                <button className="btn ghost small" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button className="btn ghost small" onClick={() => setConfirmDelete(true)}>
                Delete from wardrobe
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

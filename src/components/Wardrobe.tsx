import { useMemo, useState } from 'react'
import type { Category, WardrobeItem } from '../types'
import {
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS_PLURAL,
  FORMALITY_LABELS,
  WARMTH_LABELS,
} from '../types'
import { statFor, wearSummary, type WearStat } from '../lib/wear'
import EditItemModal from './EditItemModal'
import UploadModal from './UploadModal'

type SortKey = 'new' | 'old' | 'name' | 'least' | 'most'
type Availability = 'all' | 'ready' | 'laundry'

const SORT_LABELS: Record<SortKey, string> = {
  new: 'Newest',
  old: 'Oldest',
  name: 'Name A–Z',
  least: 'Least worn',
  most: 'Most worn',
}

export default function Wardrobe({
  items,
  urls,
  stats,
  onAdd,
  onUpdate,
  onDelete,
  onExport,
  onImport,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  stats: Map<string, WearStat>
  onAdd: (item: WardrobeItem) => Promise<void>
  onUpdate: (item: WardrobeItem) => Promise<void>
  onDelete: (id: string) => void
  onExport: () => void | Promise<void>
  onImport: (file: File) => Promise<{ items: number; outfits: number; days: number }>
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all')
  const [availability, setAvailability] = useState<Availability>('all')
  const [sort, setSort] = useState<SortKey>('new')

  const laundryCount = items.filter(i => i.unavailable).length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = items.filter(i => {
      if (catFilter !== 'all' && i.category !== catFilter) return false
      if (availability === 'ready' && i.unavailable) return false
      if (availability === 'laundry' && !i.unavailable) return false
      if (!q) return true
      return (
        i.name.toLowerCase().includes(q) || i.colorNames.some(c => c.toLowerCase().includes(q))
      )
    })
    const byStat = (i: WardrobeItem) => statFor(stats, i.id).count
    return [...matches].sort((a, b) => {
      switch (sort) {
        case 'old':
          return a.createdAt - b.createdAt
        case 'name':
          return a.name.localeCompare(b.name)
        case 'least':
          return byStat(a) - byStat(b) || b.createdAt - a.createdAt
        case 'most':
          return byStat(b) - byStat(a) || b.createdAt - a.createdAt
        default:
          return b.createdAt - a.createdAt
      }
    })
  }, [items, stats, query, catFilter, availability, sort])

  const editing = editingId ? items.find(i => i.id === editingId) : null
  const filtersOn = query.trim() !== '' || catFilter !== 'all' || availability !== 'all'

  async function handleImportFile(file: File | undefined | null) {
    if (!file || importing) return
    setImporting(true)
    setNotice(null)
    try {
      const restored = await onImport(file)
      const parts = [
        `${restored.items} piece${restored.items === 1 ? '' : 's'}`,
        `${restored.outfits} outfit${restored.outfits === 1 ? '' : 's'}`,
      ]
      if (restored.days > 0) parts.push(`${restored.days} planned day${restored.days === 1 ? '' : 's'}`)
      setNotice({ text: `Restored ${parts.join(', ')}.`, ok: true })
    } catch (err) {
      setNotice({
        text: err instanceof Error ? err.message : 'Import failed.',
        ok: false,
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Your wardrobe</h1>
          <p className="sub">Snap your clothes, cut them out, build fits.</p>
        </div>
        <div className="head-actions">
          <label className="btn ghost small">
            {importing ? 'Importing…' : 'Import backup'}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                handleImportFile(file)
              }}
            />
          </label>
          {items.length > 0 && (
            <button className="btn ghost small" onClick={onExport}>
              Export backup
            </button>
          )}
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Add a piece
          </button>
        </div>
      </div>

      {notice && <p className={notice.ok ? 'notice' : 'notice error'}>{notice.text}</p>}

      {items.length > 0 && (
        <div className="card toolbar">
          <input
            className="search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or color…"
          />
          <div className="chip-row">
            <button
              className={catFilter === 'all' ? 'chip active' : 'chip'}
              onClick={() => setCatFilter('all')}
            >
              All
            </button>
            {CATEGORIES.map(c => {
              const n = items.filter(i => i.category === c).length
              if (!n) return null
              return (
                <button
                  key={c}
                  className={catFilter === c ? 'chip active' : 'chip'}
                  onClick={() => setCatFilter(c)}
                >
                  {CATEGORY_ICONS[c]} {CATEGORY_LABELS_PLURAL[c]} ({n})
                </button>
              )
            })}
          </div>
          <div className="toolbar-row">
            <div className="chip-row">
              {(
                [
                  ['all', 'Everything'],
                  ['ready', 'Ready to wear'],
                  ['laundry', `🧺 Laundry${laundryCount ? ` (${laundryCount})` : ''}`],
                ] as Array<[Availability, string]>
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={availability === v ? 'chip active' : 'chip'}
                  onClick={() => setAvailability(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sort-select">
              <span className="label">Sort</span>
              <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty-hero">
          <div className="empty-emoji">🧥</div>
          <h2>Nothing in the closet yet</h2>
          <p>
            Upload a photo — wearing the outfit or with the piece laid flat. You mark where the
            garment is, and Fit Check cuts it out, reads its colors, and files it in your virtual
            closet.
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Upload your first piece
          </button>
        </div>
      )}

      {items.length > 0 && filtered.length === 0 && (
        <div className="empty-hero">
          <div className="empty-emoji">🔍</div>
          <h2>Nothing matches</h2>
          <p>No pieces fit those filters. Try widening the search.</p>
          <button
            className="btn ghost"
            onClick={() => {
              setQuery('')
              setCatFilter('all')
              setAvailability('all')
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {CATEGORIES.map(cat => {
        const group = filtered.filter(i => i.category === cat)
        if (!group.length) return null
        return (
          <div key={cat} className="cat-group">
            <h3>
              {CATEGORY_LABELS_PLURAL[cat]} <span className="count">{group.length}</span>
            </h3>
            <div className="card-grid">
              {group.map(item => {
                const stat = statFor(stats, item.id)
                return (
                  <div
                    key={item.id}
                    className={item.unavailable ? 'item-card unavailable' : 'item-card'}
                  >
                    <div className="card-tools">
                      <button
                        className="tool"
                        title={item.unavailable ? 'Back from the laundry' : 'Send to the laundry'}
                        onClick={() => onUpdate({ ...item, unavailable: !item.unavailable })}
                      >
                        {item.unavailable ? '↩️' : '🧺'}
                      </button>
                      <button
                        className="tool"
                        title="Edit this piece"
                        onClick={() => setEditingId(item.id)}
                      >
                        ✏️
                      </button>
                    </div>
                    <div className="item-img">
                      <img src={urls[item.id]} alt={item.name} />
                      {item.unavailable && <span className="laundry-flag">🧺 In the laundry</span>}
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
                    <div className="item-wear">{wearSummary(stat)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {filtersOn && filtered.length > 0 && (
        <p className="sub filter-note">
          Showing {filtered.length} of {items.length} pieces.{' '}
          <button
            className="linkish"
            onClick={() => {
              setQuery('')
              setCatFilter('all')
              setAvailability('all')
            }}
          >
            Clear filters
          </button>
        </p>
      )}

      {adding && (
        <UploadModal
          onClose={() => setAdding(false)}
          onSave={async item => {
            await onAdd(item)
            setAdding(false)
          }}
        />
      )}

      {editing && (
        <EditItemModal
          item={editing}
          url={urls[editing.id]}
          stats={stats}
          onClose={() => setEditingId(null)}
          onSave={async next => {
            await onUpdate(next)
            setEditingId(null)
          }}
          onDelete={id => {
            onDelete(id)
            setEditingId(null)
          }}
        />
      )}
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { Category, Formality, Warmth, WardrobeItem } from '../types'
import {
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  FORMALITY_LABELS,
  WARMTH_LABELS,
} from '../types'
import { cap, extractColors } from '../lib/colors'

type Status = 'empty' | 'processing' | 'cutout' | 'original'

export default function UploadModal({
  onSave,
  onClose,
}: {
  onSave: (item: WardrobeItem) => void | Promise<void>
  onClose: () => void
}) {
  const [original, setOriginal] = useState<Blob | null>(null)
  const [processed, setProcessed] = useState<Blob | null>(null)
  const [useCutout, setUseCutout] = useState(true)
  const [status, setStatus] = useState<Status>('empty')
  const [progress, setProgress] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [name, setName] = useState('')
  const [primaryColor, setPrimaryColor] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [warmth, setWarmth] = useState<Warmth>(2)
  const [formality, setFormality] = useState<Formality>(1)
  const [saving, setSaving] = useState(false)
  const jobRef = useRef(0)

  const activeBlob = useCutout && processed ? processed : original

  useEffect(() => {
    if (!activeBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(activeBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [activeBlob])

  useEffect(() => {
    if (!activeBlob) return
    let cancelled = false
    extractColors(activeBlob).then(cols => {
      if (!cancelled && cols.length) setPrimaryColor(cols[0].name)
    })
    return () => {
      cancelled = true
    }
  }, [activeBlob])

  async function onFile(file: File | undefined | null) {
    if (!file || !file.type.startsWith('image/')) return
    const job = ++jobRef.current
    setOriginal(file)
    setProcessed(null)
    setStatus('processing')
    setProgress('Warming up…')
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const out = await removeBackground(file, {
        progress: (key, current, total) => {
          if (jobRef.current !== job) return
          if (key.startsWith('fetch')) {
            const pct = total ? Math.round((current / total) * 100) : 0
            setProgress(`Downloading cutout model… ${pct}%`)
          } else {
            setProgress('Cutting out the garment…')
          }
        },
      })
      if (jobRef.current !== job) return
      setProcessed(out)
      setStatus('cutout')
    } catch {
      if (jobRef.current !== job) return
      setStatus('original')
    }
  }

  function reset() {
    jobRef.current++
    setOriginal(null)
    setProcessed(null)
    setStatus('empty')
    setPrimaryColor(null)
  }

  async function save() {
    if (!activeBlob || saving) return
    setSaving(true)
    try {
      const colors = await extractColors(activeBlob)
      const autoName = colors.length
        ? `${cap(colors[0].name)} ${CATEGORY_LABELS[category]}`
        : cap(CATEGORY_LABELS[category])
      await onSave({
        id: crypto.randomUUID(),
        name: name.trim() || autoName,
        category,
        colors: colors.map(c => c.hex),
        colorNames: colors.map(c => c.name),
        warmth,
        formality,
        image: activeBlob,
        createdAt: Date.now(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add a piece</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {!original ? (
          <label
            className="dropzone"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              onFile(e.dataTransfer.files?.[0])
            }}
          >
            <input type="file" accept="image/*" hidden onChange={e => onFile(e.target.files?.[0])} />
            <div className="empty-emoji">📸</div>
            <strong>Drop a photo here, or click to browse</strong>
            <span className="sub">One garment per photo works best — laid flat or on a hanger.</span>
          </label>
        ) : (
          <div className="upload-body">
            <div className="upload-preview">
              <div className="preview-frame">{previewUrl && <img src={previewUrl} alt="Garment preview" />}</div>
              {status === 'processing' && (
                <div className="processing-note">
                  <span className="spinner" /> {progress}
                </div>
              )}
              {status === 'cutout' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={useCutout}
                    onChange={e => setUseCutout(e.target.checked)}
                  />
                  Use background cutout
                </label>
              )}
              {status === 'original' && (
                <div className="sub">Couldn't remove the background — using the original photo.</div>
              )}
              <button className="btn ghost small" onClick={reset}>
                Choose a different photo
              </button>
            </div>

            <div className="upload-form">
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
              </div>
              <div className="field">
                <span className="label">Name</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={
                    primaryColor
                      ? `${cap(primaryColor)} ${CATEGORY_LABELS[category]}`
                      : 'e.g. Favorite tee'
                  }
                />
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
              <button className="btn primary wide" disabled={saving} onClick={save}>
                {saving
                  ? 'Saving…'
                  : status === 'processing'
                    ? 'Save now (skip cutout)'
                    : 'Add to wardrobe'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

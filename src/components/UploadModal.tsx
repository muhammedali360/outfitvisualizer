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
import { cropBlob, trimTransparent, type CropRect } from '../lib/image'
import CropSelector from './CropSelector'

type Stage = 'pick' | 'crop' | 'edit'
type Status = 'processing' | 'cutout' | 'original'

export default function UploadModal({
  onSave,
  onClose,
}: {
  onSave: (item: WardrobeItem) => void | Promise<void>
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('pick')
  const [original, setOriginal] = useState<Blob | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  /** The region being processed: the crop, or the whole photo. */
  const [base, setBase] = useState<Blob | null>(null)
  const [processed, setProcessed] = useState<Blob | null>(null)
  const [useCutout, setUseCutout] = useState(true)
  const [status, setStatus] = useState<Status>('processing')
  const [progress, setProgress] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [name, setName] = useState('')
  const [primaryColor, setPrimaryColor] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [warmth, setWarmth] = useState<Warmth>(2)
  const [formality, setFormality] = useState<Formality>(1)
  const [saving, setSaving] = useState(false)
  const jobRef = useRef(0)

  const activeBlob = useCutout && processed ? processed : base

  useEffect(() => {
    if (!original) {
      setOriginalUrl(null)
      return
    }
    const url = URL.createObjectURL(original)
    setOriginalUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [original])

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

  function onFile(file: File | undefined | null) {
    if (!file || !file.type.startsWith('image/')) return
    jobRef.current++
    setOriginal(file)
    setBase(null)
    setProcessed(null)
    setPrimaryColor(null)
    setStage('crop')
  }

  function backToCrop() {
    jobRef.current++
    setBase(null)
    setProcessed(null)
    setPrimaryColor(null)
    setStage('crop')
  }

  function reset() {
    jobRef.current++
    setOriginal(null)
    setBase(null)
    setProcessed(null)
    setPrimaryColor(null)
    setStage('pick')
  }

  async function confirmCrop(rect: CropRect | null) {
    if (!original) return
    const job = ++jobRef.current
    setStage('edit')
    setStatus('processing')
    setProgress('Preparing…')
    let source = original
    if (rect) {
      try {
        source = await cropBlob(original, rect)
      } catch {
        source = original
      }
    }
    if (jobRef.current !== job) return
    setBase(source)
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const out = await removeBackground(source, {
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
      const trimmed = await trimTransparent(out).catch(() => out)
      if (jobRef.current !== job) return
      setProcessed(trimmed)
      setStatus('cutout')
    } catch {
      if (jobRef.current !== job) return
      setStatus('original')
    }
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
          <h2>{stage === 'crop' ? 'Where should we look?' : 'Add a piece'}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {stage === 'pick' && (
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
            <span className="sub">
              Wearing the piece or laid flat — you'll mark where to look next.
            </span>
          </label>
        )}

        {stage === 'crop' && originalUrl && (
          <CropSelector src={originalUrl} onConfirm={confirmCrop} onBack={reset} />
        )}

        {stage === 'edit' && (
          <div className="upload-body">
            <div className="upload-preview">
              <div className="preview-frame">
                {previewUrl && <img src={previewUrl} alt="Garment preview" />}
              </div>
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
                <div className="sub">Couldn't remove the background — using the photo as-is.</div>
              )}
              <div className="chip-row">
                <button className="btn ghost small" onClick={backToCrop}>
                  Pick a different area
                </button>
                <button className="btn ghost small" onClick={reset}>
                  Different photo
                </button>
              </div>
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

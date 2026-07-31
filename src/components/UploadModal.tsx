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
import { eraseFaces } from '../lib/face'
import { composeGarment, segmentClothes, type ClothesSegmentation } from '../lib/garment'
import { cropBlob, type CropRect } from '../lib/image'
import { refineMatte } from '../lib/matte'
import { normalizeGarment } from '../lib/normalize'
import { detectPose, garmentTilt, poseAnchor, type PoseResult } from '../lib/pose'
import { parsePrice } from '../lib/value'
import CropSelector from './CropSelector'

type Stage = 'pick' | 'crop' | 'edit'
type Status = 'processing' | 'cutout' | 'original'
type Method = 'smart' | 'bg' | null

export default function UploadModal({
  currency,
  onSave,
  onClose,
}: {
  currency: string
  onSave: (item: WardrobeItem) => void | Promise<void>
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('pick')
  const [original, setOriginal] = useState<Blob | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  /** The region being processed: the crop, or the whole photo. */
  const [base, setBase] = useState<Blob | null>(null)
  const [processedKeepFace, setProcessedKeepFace] = useState<Blob | null>(null)
  const [processedNoFace, setProcessedNoFace] = useState<Blob | null>(null)
  const [faces, setFaces] = useState(0)
  const [faceOk, setFaceOk] = useState(true)
  const [eraseFace, setEraseFace] = useState(true)
  const [useCutout, setUseCutout] = useState(true)
  const [method, setMethod] = useState<Method>(null)
  const [smartNote, setSmartNote] = useState<'any' | 'bg' | null>(null)
  const [status, setStatus] = useState<Status>('processing')
  const [progress, setProgress] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [name, setName] = useState('')
  const [primaryColor, setPrimaryColor] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [warmth, setWarmth] = useState<Warmth>(2)
  const [formality, setFormality] = useState<Formality>(1)
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const jobRef = useRef(0)
  const segCacheRef = useRef<{
    source: Blob
    seg: ClothesSegmentation
    pose?: PoseResult | null
  } | null>(null)
  const composedCatRef = useRef<Category | null>(null)
  const lastModeRef = useRef<'smart' | 'bg' | null>(null)

  const cutout = eraseFace ? processedNoFace : processedKeepFace
  const activeBlob = useCutout && cutout ? cutout : base

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

  // Switching category after a smart extraction re-cuts the new garment from
  // the cached parse — no re-download, no re-inference.
  useEffect(() => {
    if (stage !== 'edit' || lastModeRef.current !== 'smart') return
    const cache = segCacheRef.current
    if (!cache || composedCatRef.current === category) return
    const job = ++jobRef.current
    setStatus('processing')
    setProgress(`Switching to the ${CATEGORY_LABELS[category]}…`)
    void smartPath(cache.source, category, job)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, stage])

  function clearProcessed() {
    setBase(null)
    setProcessedKeepFace(null)
    setProcessedNoFace(null)
    setFaces(0)
    setFaceOk(true)
    setMethod(null)
    setSmartNote(null)
    setPrimaryColor(null)
    segCacheRef.current = null
    composedCatRef.current = null
    lastModeRef.current = null
  }

  function onFile(file: File | undefined | null) {
    if (!file || !file.type.startsWith('image/')) return
    jobRef.current++
    setOriginal(file)
    clearProcessed()
    setStage('crop')
  }

  function backToCrop() {
    jobRef.current++
    clearProcessed()
    setStage('crop')
  }

  function reset() {
    jobRef.current++
    setOriginal(null)
    clearProcessed()
    setStage('pick')
  }

  async function process(rect: CropRect | null, mode: 'smart' | 'bg') {
    if (!original) return
    const job = ++jobRef.current
    lastModeRef.current = mode
    segCacheRef.current = null
    composedCatRef.current = null
    setSmartNote(null)
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
    if (mode === 'smart') await smartPath(source, category, job)
    else await bgRemovePath(source, job)
  }

  async function smartPath(source: Blob, cat: Category, job: number) {
    composedCatRef.current = cat
    try {
      setProgress(`Looking for the ${CATEGORY_LABELS[cat]}…`)
      let seg: ClothesSegmentation
      if (segCacheRef.current?.source === source) {
        seg = segCacheRef.current.seg
      } else {
        seg = await segmentClothes(source, msg => {
          if (jobRef.current === job) setProgress(msg)
        })
        if (jobRef.current !== job) return
        segCacheRef.current = { source, seg }
      }
      // Exact category first; if that garment isn't found, fall back to every
      // wearable pixel from the same parse (still no skin/face/background,
      // and no extra model download).
      let res = await composeGarment(source, seg, cat)
      let note: 'any' | null = null
      if (!res) {
        res = await composeGarment(source, seg, 'any')
        note = 'any'
      }
      if (jobRef.current !== job) return
      if (res) {
        // Pose is detected once per photo and cached with the parse, so
        // switching category reuses it.
        const cache = segCacheRef.current
        if (cache && cache.pose === undefined) {
          setProgress('Reading the pose…')
          cache.pose = await detectPose(source)
          if (jobRef.current !== job) return
        }
        const pose = cache?.pose ?? null
        // A mixed 'any' cutout doesn't hang off one body line, so don't trust
        // pose for it. Passing null lets normalization read the tilt off the
        // silhouette instead, which still works for a mixed piece.
        const tilt = pose && note === null ? garmentTilt(pose, cat) : null
        const anchor = pose && note === null ? poseAnchor(pose, cat) : null

        // Refine the edges while the cutout is still full-resolution and
        // aligned with the photo — the matte needs the original pixels, and
        // normalization is about to rotate and crop them.
        const refined = await refineMatte(source, res.blob, msg => {
          if (jobRef.current === job) setProgress(msg)
        })
        if (jobRef.current !== job) return
        const cut = refined ?? res.blob

        setProgress('Straightening and framing…')
        const normalized = await normalizeGarment(cut, cat, tilt, anchor).catch(() => cut)
        if (jobRef.current !== job) return
        setProcessedKeepFace(normalized)
        setProcessedNoFace(normalized)
        setFaces(0)
        setFaceOk(true)
        setMethod('smart')
        setSmartNote(note)
        setStatus('cutout')
        return
      }
    } catch {
      if (jobRef.current !== job) return
    }
    // No wearable pixels found at all (flat-lay shots, unusual pieces):
    // degrade to plain background removal.
    if (jobRef.current !== job) return
    setSmartNote('bg')
    setProgress('Falling back to background removal…')
    await bgRemovePath(source, job)
  }

  async function bgRemovePath(source: Blob, job: number) {
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
      // Refine before erasing faces, not after: the matte recomposites the
      // original photo's pixels under a new alpha, so running it second would
      // paint an erased face straight back in.
      const refined = await refineMatte(source, out, msg => {
        if (jobRef.current === job) setProgress(msg)
      })
      if (jobRef.current !== job) return
      const cut = refined ?? out
      setProgress('Checking for faces…')
      const faceResult = await eraseFaces(cut)
      if (jobRef.current !== job) return
      setProgress('Straightening and framing…')
      // No pose here — this path exists because the parse found nothing, which
      // usually means there's no body in the photo. Normalization falls back to
      // the garment's own symmetry axis.
      const frame = (b: Blob) => normalizeGarment(b, category, null).catch(() => b)
      const trimmedKeep = await frame(cut)
      const trimmedNoFace = faceResult.faces > 0 ? await frame(faceResult.blob) : trimmedKeep
      if (jobRef.current !== job) return
      setProcessedKeepFace(trimmedKeep)
      setProcessedNoFace(trimmedNoFace)
      setFaces(faceResult.faces)
      setFaceOk(faceResult.ok)
      setMethod('bg')
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
        price: parsePrice(price),
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
          <h2>{stage === 'crop' ? 'What are we adding?' : 'Add a piece'}</h2>
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
              Wearing the outfit or laid flat — the garment AI picks out each piece.
            </span>
          </label>
        )}

        {stage === 'crop' && originalUrl && (
          <CropSelector
            src={originalUrl}
            category={category}
            onCategoryChange={setCategory}
            onConfirm={(rect, mode) => void process(rect, mode)}
            onBack={reset}
          />
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
                <>
                  {method === 'smart' && smartNote === null && (
                    <div className="sub good-note">
                      ✂️ Grabbed just the {CATEGORY_LABELS[category]} — skin, face and everything
                      else left out.
                    </div>
                  )}
                  {method === 'smart' && smartNote === 'any' && (
                    <div className="sub">
                      Couldn't isolate just the {CATEGORY_LABELS[category]} — grabbed the clothing
                      it found instead. Wrong piece? Switch the category chips.
                    </div>
                  )}
                  {method === 'bg' && smartNote === 'bg' && (
                    <div className="sub">
                      Couldn't spot clothing in the photo — removed the background instead.
                    </div>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={useCutout}
                      onChange={e => setUseCutout(e.target.checked)}
                    />
                    Use cutout
                  </label>
                  {method === 'bg' && faces > 0 && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={eraseFace}
                        onChange={e => setEraseFace(e.target.checked)}
                      />
                      Erase {faces === 1 ? 'the face' : `all ${faces} faces`} 🕶️
                    </label>
                  )}
                  {method === 'bg' && !faceOk && (
                    <div className="sub">
                      Couldn't run the face check — eyeball the preview before saving.
                    </div>
                  )}
                </>
              )}
              {status === 'original' && (
                <div className="sub">Couldn't process the image — using the photo as-is.</div>
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
                <span className="label">What it cost ({currency})</span>
                <input
                  inputMode="decimal"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="Optional — unlocks cost per wear"
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

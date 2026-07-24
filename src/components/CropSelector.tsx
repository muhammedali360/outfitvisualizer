import { useRef, useState } from 'react'
import type { CropRect } from '../lib/image'

type Mode = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'

interface Point {
  x: number
  y: number
}

const MIN_SIZE = 0.04

/**
 * Lets the user drag a box over the photo to mark where the garment is.
 * Coordinates are fractions of the displayed image, so they map directly
 * onto the natural-resolution bitmap regardless of on-screen size.
 */
export default function CropSelector({
  src,
  onConfirm,
  onBack,
}: {
  src: string
  onConfirm: (rect: CropRect | null) => void
  onBack: () => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const dragRef = useRef<{ mode: Mode; start: Point; orig: CropRect | null } | null>(null)

  function toFrac(e: React.PointerEvent): Point {
    const b = stageRef.current!.getBoundingClientRect()
    return {
      x: clamp((e.clientX - b.left) / b.width),
      y: clamp((e.clientY - b.top) / b.height),
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    stageRef.current?.setPointerCapture(e.pointerId)
    const p = toFrac(e)
    const mode = (((e.target as HTMLElement).dataset.mode as Mode | undefined) ?? 'draw') as Mode
    dragRef.current = { mode, start: p, orig: rect }
    if (mode === 'draw') setRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const p = toFrac(e)
    if (d.mode === 'draw') {
      setRect(normRect(d.start, p))
    } else if (!d.orig) {
      return
    } else if (d.mode === 'move') {
      const o = d.orig
      const dx = Math.min(Math.max(p.x - d.start.x, -o.x), 1 - o.x - o.w)
      const dy = Math.min(Math.max(p.y - d.start.y, -o.y), 1 - o.y - o.h)
      setRect({ ...o, x: o.x + dx, y: o.y + dy })
    } else {
      const o = d.orig
      const fixed: Point =
        d.mode === 'nw'
          ? { x: o.x + o.w, y: o.y + o.h }
          : d.mode === 'ne'
            ? { x: o.x, y: o.y + o.h }
            : d.mode === 'sw'
              ? { x: o.x + o.w, y: o.y }
              : { x: o.x, y: o.y }
      setRect(normRect(fixed, p))
    }
  }

  function onPointerUp() {
    const d = dragRef.current
    dragRef.current = null
    if (rect && (rect.w < MIN_SIZE || rect.h < MIN_SIZE)) {
      setRect(d?.mode === 'draw' ? null : (d?.orig ?? null))
    }
  }

  const usable = !!rect && rect.w >= MIN_SIZE && rect.h >= MIN_SIZE

  return (
    <div className="crop-wrap">
      <p className="sub crop-copy">
        Drag a box around the piece you're adding — the cutout will only look there. Wearing a
        full outfit? Add it once per piece, boxing a different garment each time.
      </p>
      <div
        ref={stageRef}
        className="crop-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img src={src} alt="Uploaded photo" draggable={false} />
        {rect && (
          <>
            <div className="crop-dim">
              <div
                className="crop-dim-hole"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              />
            </div>
            <div
              className="crop-rect"
              data-mode="move"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
            >
              <i data-mode="nw" />
              <i data-mode="ne" />
              <i data-mode="sw" />
              <i data-mode="se" />
            </div>
          </>
        )}
        {!rect && <div className="crop-hint">Drag to mark the garment</div>}
      </div>
      <div className="crop-actions">
        <button className="btn ghost small" onClick={onBack}>
          Different photo
        </button>
        <button className="btn ghost small" onClick={() => onConfirm(null)}>
          Use whole photo
        </button>
        <button className="btn primary" disabled={!usable} onClick={() => rect && onConfirm(rect)}>
          Cut out this area
        </button>
      </div>
    </div>
  )
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function normRect(a: Point, b: Point): CropRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

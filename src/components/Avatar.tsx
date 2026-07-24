import type { Category } from '../types'

interface Slot {
  x: number
  y: number
  w: number
  h: number
  align: string
}

const SLOTS: Record<Category, Slot> = {
  hat: { x: 103, y: 2, w: 114, h: 74, align: 'xMidYMax' },
  top: { x: 56, y: 114, w: 208, h: 218, align: 'xMidYMin' },
  bottom: { x: 78, y: 306, w: 164, h: 238, align: 'xMidYMin' },
  shoes: { x: 68, y: 542, w: 184, h: 92, align: 'xMidYMax' },
}

// Paint bottoms first so the top overlaps the waist, hat last so it sits on top.
const ORDER: Category[] = ['bottom', 'top', 'shoes', 'hat']

export default function Avatar({
  images,
  showHints = false,
}: {
  images: Partial<Record<Category, string>>
  showHints?: boolean
}) {
  return (
    <svg viewBox="0 0 320 660" className="avatar" role="img" aria-label="Outfit preview">
      <ellipse cx="160" cy="640" rx="120" ry="14" fill="rgba(30,25,18,0.07)" />
      <g fill="#ddd6cb">
        <ellipse cx="160" cy="62" rx="30" ry="36" />
        <rect x="148" y="92" width="24" height="24" rx="10" />
        <path d="M104 126 Q160 108 216 126 L230 302 Q160 320 90 302 Z" />
        <rect x="70" y="128" width="24" height="172" rx="12" transform="rotate(5 82 128)" />
        <rect x="226" y="128" width="24" height="172" rx="12" transform="rotate(-5 238 128)" />
        <rect x="112" y="300" width="42" height="250" rx="20" />
        <rect x="166" y="300" width="42" height="250" rx="20" />
        <ellipse cx="131" cy="580" rx="32" ry="16" />
        <ellipse cx="189" cy="580" rx="32" ry="16" />
      </g>
      {ORDER.map(slot => {
        const s = SLOTS[slot]
        const href = images[slot]
        if (!href) {
          if (!showHints) return null
          return (
            <g key={slot}>
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx="12"
                fill="none"
                stroke="#c9c0b2"
                strokeDasharray="5 6"
                strokeWidth="1.5"
                opacity="0.55"
              />
              <text
                x={s.x + s.w / 2}
                y={s.y + s.h / 2}
                textAnchor="middle"
                fill="#a99d8b"
                fontSize="13"
              >
                {slot}
              </text>
            </g>
          )
        }
        return (
          <image
            key={slot}
            href={href}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            preserveAspectRatio={`${s.align} meet`}
          />
        )
      })}
    </svg>
  )
}

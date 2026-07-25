export type Category = 'hat' | 'top' | 'layer' | 'bottom' | 'shoes'

export const CATEGORIES: Category[] = ['hat', 'top', 'layer', 'bottom', 'shoes']

/** Slots a complete outfit must fill; hats and layers are optional extras. */
export const CORE_CATEGORIES: Category[] = ['top', 'bottom', 'shoes']

export const CATEGORY_LABELS: Record<Category, string> = {
  hat: 'hat',
  top: 'top',
  layer: 'jacket',
  bottom: 'bottoms',
  shoes: 'shoes',
}

export const CATEGORY_LABELS_PLURAL: Record<Category, string> = {
  hat: 'Hats',
  top: 'Tops',
  layer: 'Outerwear',
  bottom: 'Bottoms',
  shoes: 'Shoes',
}

export const CATEGORY_ICONS: Record<Category, string> = {
  hat: '🎩',
  top: '👕',
  layer: '🧥',
  bottom: '👖',
  shoes: '👟',
}

export type Warmth = 1 | 2 | 3
export type Formality = 1 | 2 | 3

export const WARMTH_LABELS: Record<Warmth, string> = {
  1: 'Light',
  2: 'Midweight',
  3: 'Warm',
}

export const FORMALITY_LABELS: Record<Formality, string> = {
  1: 'Casual',
  2: 'Smart casual',
  3: 'Dressy',
}

export interface WardrobeItem {
  id: string
  name: string
  category: Category
  /** Dominant colors as hex strings, most dominant first. */
  colors: string[]
  /** Human-readable names for `colors`, same order. */
  colorNames: string[]
  warmth: Warmth
  formality: Formality
  image: Blob
  createdAt: number
  /** In the laundry / packed away — hidden from the stylist until it's back. */
  unavailable?: boolean
}

export interface Outfit {
  id: string
  name: string
  items: Partial<Record<Category, string>>
  createdAt: number
}

/**
 * One day on the calendar: what's planned for it and whether it was actually
 * worn. Wear counts and last-worn dates are derived from these, so there's a
 * single source of truth for both planning and history.
 */
export interface DayPlan {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string
  items: Partial<Record<Category, string>>
  worn: boolean
  updatedAt: number
}

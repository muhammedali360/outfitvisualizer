export type Category = 'hat' | 'top' | 'bottom' | 'shoes'

export const CATEGORIES: Category[] = ['hat', 'top', 'bottom', 'shoes']

export const CATEGORY_LABELS: Record<Category, string> = {
  hat: 'hat',
  top: 'top',
  bottom: 'bottoms',
  shoes: 'shoes',
}

export const CATEGORY_LABELS_PLURAL: Record<Category, string> = {
  hat: 'Hats',
  top: 'Tops',
  bottom: 'Bottoms',
  shoes: 'Shoes',
}

export const CATEGORY_ICONS: Record<Category, string> = {
  hat: '🎩',
  top: '👕',
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
}

export interface Outfit {
  id: string
  name: string
  items: Partial<Record<Category, string>>
  createdAt: number
}

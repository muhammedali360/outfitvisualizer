import type { Category, Outfit, WardrobeItem } from '../types'
import { CATEGORIES } from '../types'
import * as db from '../db'

const APP_TAG = 'fit-check'

interface BackupFile {
  app: typeof APP_TAG
  version: 1
  exportedAt: number
  items: Array<Omit<WardrobeItem, 'image'> & { image: string }>
  outfits: Outfit[]
}

/**
 * Download the whole closet — garment images included — as a single JSON
 * file that `importBackup` can restore on any device or domain.
 */
export async function exportBackup(items: WardrobeItem[], outfits: Outfit[]): Promise<void> {
  const payload: BackupFile = {
    app: APP_TAG,
    version: 1,
    exportedAt: Date.now(),
    items: await Promise.all(
      items.map(async i => ({ ...i, image: await blobToDataUrl(i.image) })),
    ),
    outfits,
  }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fitcheck-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Restore a backup file into IndexedDB. Entries are merged by id, so
 * re-importing the same backup is harmless. Returns how much was restored.
 */
export async function importBackup(file: File): Promise<{ items: number; outfits: number }> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const backup = data as Partial<BackupFile>
  if (backup?.app !== APP_TAG || !Array.isArray(backup.items) || !Array.isArray(backup.outfits)) {
    throw new Error("That doesn't look like a Fit Check backup file.")
  }

  const items: WardrobeItem[] = []
  for (const entry of backup.items as unknown[]) {
    const raw = entry as Record<string, unknown>
    if (!raw || typeof raw.id !== 'string') continue
    if (typeof raw.image !== 'string' || !raw.image.startsWith('data:image/')) continue
    if (typeof raw.category !== 'string' || !(CATEGORIES as string[]).includes(raw.category)) continue
    const image = await (await fetch(raw.image)).blob()
    items.push({
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : 'Imported piece',
      category: raw.category as Category,
      colors: Array.isArray(raw.colors) ? raw.colors.map(String) : [],
      colorNames: Array.isArray(raw.colorNames) ? raw.colorNames.map(String) : [],
      warmth: levelOf(raw.warmth, 2),
      formality: levelOf(raw.formality, 1),
      image,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    })
  }

  // Outfit slots may only reference items that exist after the merge.
  const validIds = new Set(items.map(i => i.id))
  for (const existing of await db.getAllItems()) validIds.add(existing.id)

  const outfits: Outfit[] = []
  for (const entry of backup.outfits as unknown[]) {
    const raw = entry as Record<string, unknown>
    if (!raw || typeof raw.id !== 'string') continue
    if (typeof raw.items !== 'object' || raw.items === null) continue
    const slots: Partial<Record<Category, string>> = {}
    for (const c of CATEGORIES) {
      const id = (raw.items as Record<string, unknown>)[c]
      if (typeof id === 'string' && validIds.has(id)) slots[c] = id
    }
    if (Object.keys(slots).length === 0) continue
    outfits.push({
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : 'Imported outfit',
      items: slots,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    })
  }

  for (const i of items) await db.putItem(i)
  for (const o of outfits) await db.putOutfit(o)
  return { items: items.length, outfits: outfits.length }
}

function levelOf(v: unknown, fallback: 1 | 2 | 3): 1 | 2 | 3 {
  return v === 1 || v === 2 || v === 3 ? v : fallback
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

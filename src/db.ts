import type { DayPlan, Outfit, WardrobeItem } from './types'

const DB_NAME = 'fit-check'
// v2 added the `days` store (calendar plans + wear log).
const DB_VERSION = 2

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('items')) {
        db.createObjectStore('items', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('outfits')) {
        db.createObjectStore('outfits', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('days')) {
        db.createObjectStore('days', { keyPath: 'date' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
const db = () => (dbPromise ??= openDb())

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    d =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(store, mode).objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const getAllItems = () =>
  run('items', 'readonly', s => s.getAll() as IDBRequest<WardrobeItem[]>)

export const putItem = (item: WardrobeItem) =>
  run('items', 'readwrite', s => s.put(item)).then(() => undefined)

export const deleteItem = (id: string) =>
  run('items', 'readwrite', s => s.delete(id)).then(() => undefined)

export const getAllOutfits = () =>
  run('outfits', 'readonly', s => s.getAll() as IDBRequest<Outfit[]>)

export const putOutfit = (outfit: Outfit) =>
  run('outfits', 'readwrite', s => s.put(outfit)).then(() => undefined)

export const deleteOutfit = (id: string) =>
  run('outfits', 'readwrite', s => s.delete(id)).then(() => undefined)

export const getAllDays = () => run('days', 'readonly', s => s.getAll() as IDBRequest<DayPlan[]>)

export const putDay = (day: DayPlan) =>
  run('days', 'readwrite', s => s.put(day)).then(() => undefined)

export const deleteDay = (date: string) =>
  run('days', 'readwrite', s => s.delete(date)).then(() => undefined)

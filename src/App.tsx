import { useEffect, useState } from 'react'
import type { Category, Outfit, WardrobeItem } from './types'
import { CATEGORIES } from './types'
import * as db from './db'
import { exportBackup, importBackup } from './lib/backup'
import { fetchWeather } from './lib/weather'
import Wardrobe from './components/Wardrobe'
import OutfitBuilder from './components/OutfitBuilder'
import Suggestions, { type WeatherState } from './components/Suggestions'

type Tab = 'wardrobe' | 'studio' | 'stylist'

const TAB_TITLES: Record<Tab, string> = {
  wardrobe: 'Wardrobe',
  studio: 'Outfit Studio',
  stylist: 'Stylist',
}

export default function App() {
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [outfits, setOutfits] = useState<Outfit[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>('wardrobe')
  const [selection, setSelection] = useState<Partial<Record<Category, string>>>({})
  const [weather, setWeather] = useState<WeatherState>('loading')

  async function loadAll() {
    const [its, ofs] = await Promise.all([db.getAllItems(), db.getAllOutfits()])
    setItems(its.sort((a, b) => a.createdAt - b.createdAt))
    setOutfits(ofs.sort((a, b) => a.createdAt - b.createdAt))
    setUrls(prev => {
      for (const url of Object.values(prev)) URL.revokeObjectURL(url)
      return Object.fromEntries(its.map(i => [i.id, URL.createObjectURL(i.image)]))
    })
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask for weather (and the geolocation permission it needs) only once the
  // user actually opens the stylist.
  useEffect(() => {
    if (tab !== 'stylist' || weather !== 'loading') return
    let cancelled = false
    fetchWeather().then(w => {
      if (!cancelled) setWeather(w ?? 'error')
    })
    return () => {
      cancelled = true
    }
  }, [tab, weather])

  async function addItem(item: WardrobeItem) {
    await db.putItem(item)
    setItems(prev => [...prev, item])
    setUrls(prev => ({ ...prev, [item.id]: URL.createObjectURL(item.image) }))
  }

  async function removeItem(id: string) {
    await db.deleteItem(id)
    setItems(prev => prev.filter(i => i.id !== id))
    setSelection(prev => {
      const next = { ...prev }
      for (const c of CATEGORIES) if (next[c] === id) delete next[c]
      return next
    })
    setUrls(prev => {
      const next = { ...prev }
      if (next[id]) URL.revokeObjectURL(next[id])
      delete next[id]
      return next
    })
  }

  async function saveOutfit(outfit: Outfit) {
    await db.putOutfit(outfit)
    setOutfits(prev => [...prev.filter(o => o.id !== outfit.id), outfit])
  }

  async function removeOutfit(id: string) {
    await db.deleteOutfit(id)
    setOutfits(prev => prev.filter(o => o.id !== id))
  }

  function wearSelection(sel: Partial<Record<Category, string>>) {
    setSelection(sel)
    setTab('studio')
  }

  async function handleImport(file: File) {
    const restored = await importBackup(file)
    await loadAll()
    return restored
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          Fit<span>Check</span>
        </div>
        <nav className="tabs">
          {(Object.keys(TAB_TITLES) as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {TAB_TITLES[t]}
              {t === 'wardrobe' && items.length > 0 ? ` (${items.length})` : ''}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'wardrobe' && (
          <Wardrobe
            items={items}
            urls={urls}
            onAdd={addItem}
            onDelete={removeItem}
            onExport={() => exportBackup(items, outfits)}
            onImport={handleImport}
          />
        )}
        {tab === 'studio' && (
          <OutfitBuilder
            items={items}
            urls={urls}
            selection={selection}
            onChange={setSelection}
            outfits={outfits}
            onSaveOutfit={saveOutfit}
            onDeleteOutfit={removeOutfit}
            onGoWardrobe={() => setTab('wardrobe')}
          />
        )}
        {tab === 'stylist' && (
          <Suggestions
            items={items}
            urls={urls}
            weather={weather}
            onWear={wearSelection}
            onGoWardrobe={() => setTab('wardrobe')}
          />
        )}
      </main>
    </div>
  )
}

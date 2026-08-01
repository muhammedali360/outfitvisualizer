import { useEffect, useMemo, useState } from 'react'
import type { Category, DayPlan, Outfit, WardrobeItem } from './types'
import { CATEGORIES } from './types'
import * as db from './db'
import { exportBackup, importBackup } from './lib/backup'
import { targetWarmthForTemp } from './lib/suggest'
import { selectionIsEmpty, todayKey, wearStats } from './lib/wear'
import { fetchForecast, type Forecast } from './lib/weather'
import Wardrobe from './components/Wardrobe'
import OutfitBuilder from './components/OutfitBuilder'
import Planner from './components/Planner'
import Suggestions from './components/Suggestions'
import Trip from './components/Trip'

type Tab = 'wardrobe' | 'studio' | 'plan' | 'stylist' | 'trip'
type ForecastState = Forecast | 'loading' | 'error'
type Selection = Partial<Record<Category, string>>

const TAB_TITLES: Record<Tab, string> = {
  wardrobe: 'Wardrobe',
  studio: 'Outfit Studio',
  plan: 'Week',
  stylist: 'Stylist',
  trip: 'Pack',
}

/** Tabs that need the forecast, and so trigger the geolocation prompt. */
const WEATHER_TABS: Tab[] = ['plan', 'stylist']

export default function App() {
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [outfits, setOutfits] = useState<Outfit[]>([])
  const [days, setDays] = useState<DayPlan[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>('wardrobe')
  const [selection, setSelection] = useState<Selection>({})
  const [forecast, setForecast] = useState<ForecastState>('loading')

  async function loadAll() {
    const [its, ofs, dys] = await Promise.all([
      db.getAllItems(),
      db.getAllOutfits(),
      db.getAllDays(),
    ])
    setItems(its.sort((a, b) => a.createdAt - b.createdAt))
    setOutfits(ofs.sort((a, b) => a.createdAt - b.createdAt))
    setDays(dys)
    setUrls(prev => {
      for (const url of Object.values(prev)) URL.revokeObjectURL(url)
      return Object.fromEntries(its.map(i => [i.id, URL.createObjectURL(i.image)]))
    })
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask for the forecast (and the geolocation permission it needs) only once
  // the user opens a tab that actually uses it.
  useEffect(() => {
    if (!WEATHER_TABS.includes(tab) || forecast !== 'loading') return
    let cancelled = false
    fetchForecast().then(f => {
      if (!cancelled) setForecast(f ?? 'error')
    })
    return () => {
      cancelled = true
    }
  }, [tab, forecast])

  const live = typeof forecast === 'object' ? forecast : null
  const stats = useMemo(() => wearStats(days), [days])
  const today = todayKey()
  const todayPlan = days.find(d => d.date === today) ?? null

  async function addItem(item: WardrobeItem) {
    await db.putItem(item)
    setItems(prev => [...prev, item])
    setUrls(prev => ({ ...prev, [item.id]: URL.createObjectURL(item.image) }))
  }

  async function updateItem(item: WardrobeItem) {
    await db.putItem(item)
    setItems(prev => prev.map(i => (i.id === item.id ? item : i)))
    // The image itself can change (re-framing after a category switch), so the
    // object URL has to be re-minted rather than reused.
    setUrls(prev => {
      const old = prev[item.id]
      const next = URL.createObjectURL(item.image)
      if (old) URL.revokeObjectURL(old)
      return { ...prev, [item.id]: next }
    })
  }

  async function removeItem(id: string) {
    await db.deleteItem(id)
    setItems(prev => prev.filter(i => i.id !== id))
    setSelection(prev => stripItem(prev, id))
    // Drop the piece from every plan too, and bin any day it leaves empty.
    const affected = days.filter(d => CATEGORIES.some(c => d.items[c] === id))
    for (const day of affected) {
      const next = { ...day, items: stripItem(day.items, id), updatedAt: Date.now() }
      if (selectionIsEmpty(next.items)) await db.deleteDay(day.date)
      else await db.putDay(next)
    }
    if (affected.length) {
      setDays(prev =>
        prev
          .map(d => (CATEGORIES.some(c => d.items[c] === id) ? { ...d, items: stripItem(d.items, id) } : d))
          .filter(d => !selectionIsEmpty(d.items)),
      )
    }
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

  async function setDay(date: string, sel: Selection, worn?: boolean) {
    const existing = days.find(d => d.date === date)
    const day: DayPlan = {
      date,
      items: { ...sel },
      worn: worn ?? existing?.worn ?? false,
      updatedAt: Date.now(),
    }
    await db.putDay(day)
    setDays(prev => [...prev.filter(d => d.date !== date), day])
  }

  async function clearDay(date: string) {
    await db.deleteDay(date)
    setDays(prev => prev.filter(d => d.date !== date))
  }

  async function toggleWorn(date: string) {
    const existing = days.find(d => d.date === date)
    if (!existing) return
    const day = { ...existing, worn: !existing.worn, updatedAt: Date.now() }
    await db.putDay(day)
    setDays(prev => prev.map(d => (d.date === date ? day : d)))
  }

  /** Log the studio's current combination as what was worn today. */
  async function wearToday(sel: Selection) {
    await setDay(today, sel, true)
  }

  function openInStudio(sel: Selection) {
    setSelection(sel)
    setTab('studio')
  }

  async function handleImport(file: File) {
    const restored = await importBackup(file)
    await loadAll()
    return restored
  }

  const wornToday =
    !!todayPlan?.worn && !selectionIsEmpty(selection) && sameSelection(todayPlan.items, selection)

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          Fit<span>Check</span> <em className="ver">v0.6</em>
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
            stats={stats}
            onAdd={addItem}
            onUpdate={updateItem}
            onDelete={removeItem}
            onExport={() => exportBackup(items, outfits, days)}
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
            onWoreToday={wearToday}
            wornToday={wornToday}
            targetWarmth={live ? targetWarmthForTemp(live.today.tempC) : null}
          />
        )}
        {tab === 'plan' && (
          <Planner
            items={items}
            urls={urls}
            outfits={outfits}
            days={days}
            forecast={live?.days ?? null}
            weatherPending={forecast === 'loading'}
            studioSelection={selection}
            onSetDay={(date, sel) => void setDay(date, sel)}
            onClearDay={date => void clearDay(date)}
            onToggleWorn={date => void toggleWorn(date)}
            onOpenInStudio={openInStudio}
            onGoWardrobe={() => setTab('wardrobe')}
          />
        )}
        {tab === 'stylist' && (
          <Suggestions
            items={items}
            urls={urls}
            weather={forecast === 'loading' ? 'loading' : forecast === 'error' ? 'error' : forecast.today}
            onWear={openInStudio}
            onGoWardrobe={() => setTab('wardrobe')}
          />
        )}
        {tab === 'trip' && (
          <Trip items={items} urls={urls} onGoWardrobe={() => setTab('wardrobe')} />
        )}
      </main>
    </div>
  )
}

function stripItem(sel: Selection, id: string): Selection {
  const next = { ...sel }
  for (const c of CATEGORIES) if (next[c] === id) delete next[c]
  return next
}

function sameSelection(a: Selection, b: Selection): boolean {
  return CATEGORIES.every(c => a[c] === b[c])
}

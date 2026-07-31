import { useMemo, useState } from 'react'
import type { WardrobeItem, Warmth } from '../types'
import { CATEGORY_LABELS_PLURAL } from '../types'
import { statFor, wearSummary, type WearStat } from '../lib/wear'
import {
  closetValue,
  costPerWearRanking,
  CURRENCIES,
  declutterReview,
  formatMoney,
  hasPrice,
  humanDays,
  utilization,
  wearConcentration,
  wearsToTarget,
  WEAR_TARGET,
  WRAP_UTILIZATION,
  type RankedItem,
} from '../lib/value'

/**
 * What the closet is worth, what it's costing per wear, and what's stopped
 * pulling its weight. Every figure is either definitional or measured off this
 * wardrobe — nothing here asserts a rule of thumb at the user.
 */
export default function Insights({
  items,
  urls,
  stats,
  currency,
  onCurrencyChange,
  todayWarmth,
  onFindInWardrobe,
  onGoWardrobe,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  stats: Map<string, WearStat>
  currency: string
  onCurrencyChange: (code: string) => void
  /** How today's weather reads, when we have it — keeps off-season pieces off the declutter list. */
  todayWarmth: Warmth | null
  onFindInWardrobe: (name: string) => void
  onGoWardrobe: () => void
}) {
  const [showAllIdle, setShowAllIdle] = useState(false)

  const value = useMemo(() => closetValue(items, stats), [items, stats])
  const use = useMemo(() => utilization(items, stats), [items, stats])
  const conc = useMemo(() => wearConcentration(items, stats), [items, stats])
  const ranked = useMemo(() => costPerWearRanking(items, stats), [items, stats])
  const idle = useMemo(
    () => declutterReview(items, stats, todayWarmth),
    [items, stats, todayWarmth],
  )

  const money = (n: number) => formatMoney(n, currency)

  // Best value first, worst last — but only worth showing as two lists once
  // there's enough priced history for the two ends to differ.
  const best = useMemo(() => [...ranked].sort((a, b) => a.costPerWear - b.costPerWear), [ranked])
  const worst = useMemo(() => [...ranked].sort((a, b) => b.costPerWear - a.costPerWear), [ranked])
  const splitLists = ranked.length >= 4

  // Pieces still short of #30Wears, nearest first — the progress measure for
  // anyone who never recorded prices.
  const climbing = useMemo(
    () =>
      items
        .map(item => ({ item, stat: statFor(stats, item.id) }))
        .filter(({ stat }) => stat.count > 0 && stat.count < WEAR_TARGET)
        .sort((a, b) => b.stat.count - a.stat.count)
        .slice(0, 6),
    [items, stats],
  )

  if (items.length === 0) {
    return (
      <div className="empty-hero">
        <div className="empty-emoji">📊</div>
        <h2>Nothing to measure yet</h2>
        <p>
          Add some pieces and log what you wear — then this is where you find out what each one is
          really costing you.
        </p>
        <button className="btn primary" onClick={onGoWardrobe}>
          Go to wardrobe
        </button>
      </div>
    )
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Insights</h1>
          <p className="sub">What your closet cost, what it earns back, and what's gone quiet.</p>
        </div>
        <label className="sort-select">
          <span className="label">Currency</span>
          <select value={currency} onChange={e => onCurrencyChange(e.target.value)}>
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="stat-grid">
        <div className="card stat-tile">
          <span className="stat-label">Closet value</span>
          <strong className="stat-value">{value.priced > 0 ? money(value.total) : '—'}</strong>
          <span className="sub">
            {value.priced === 0
              ? 'No prices recorded yet — add one when you edit a piece.'
              : value.unpriced > 0
                ? `Across ${value.priced} priced piece${value.priced === 1 ? '' : 's'}; ${value.unpriced} without a price sit this one out.`
                : `Across all ${value.priced} pieces.`}
          </span>
        </div>

        <div className="card stat-tile">
          <span className="stat-label">Blended cost per wear</span>
          <strong className="stat-value">
            {value.blendedCostPerWear !== null ? money(value.blendedCostPerWear) : '—'}
          </strong>
          <span className="sub">
            {value.blendedCostPerWear !== null
              ? 'Everything you paid, divided by every wear you logged.'
              : 'Log a few wears against priced pieces and this fills in.'}
          </span>
        </div>

        <div className="card stat-tile">
          <span className="stat-label">Worn in the last year</span>
          <strong className="stat-value">
            {use.rate !== null ? `${Math.round(use.rate * 100)}%` : '—'}
          </strong>
          <span className="sub">
            {use.rate === null ? (
              `Nothing's been in the closet long enough to judge${use.tooNew ? ` — ${use.tooNew} added recently` : ''}.`
            ) : (
              <>
                {use.worn} of {use.eligible} pieces.{' '}
                {use.rate >= WRAP_UTILIZATION
                  ? `Ahead of the ${Math.round(WRAP_UTILIZATION * 100)}% WRAP found across UK wardrobes.`
                  : `WRAP put the UK average at ${Math.round(WRAP_UTILIZATION * 100)}%.`}
              </>
            )}
          </span>
        </div>

        <div className="card stat-tile">
          <span className="stat-label">Where your wears go</span>
          <strong className="stat-value">
            {conc ? `${Math.round(conc.share * 100)}%` : '—'}
          </strong>
          <span className="sub">
            {conc
              ? `Your busiest ${conc.topCount} piece${conc.topCount === 1 ? '' : 's'} — the top fifth of the closet — account for this much of ${conc.totalWears} logged wears.`
              : 'Log some wears to see how evenly the closet gets used.'}
          </span>
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="card">
          <h3>Cost per wear</h3>
          <p className="sub">
            Add what a piece cost (edit any piece in the wardrobe) and log a wear or two, and it'll
            start showing what it works out at each time you put it on. Pieces are only ever ranked
            against others in the same category — a coat is always going to look dear next to a tee.
          </p>
        </div>
      ) : (
        <div className="cpw-columns">
          <CostList
            title={splitLists ? 'Earning their keep' : 'Cost per wear'}
            note="Cheapest per wear in its category first."
            entries={best.slice(0, 5)}
            urls={urls}
            currency={currency}
          />
          {splitLists && (
            <CostList
              title="Costing you the most"
              note="Not necessarily mistakes — just the ones yet to pay for themselves."
              entries={worst.slice(0, 5)}
              urls={urls}
              currency={currency}
            />
          )}
        </div>
      )}

      {climbing.length > 0 && (
        <div className="card">
          <h3>On the way to 30 wears</h3>
          <p className="sub">
            Livia Firth's #30Wears test — will you wear it thirty times? — needs no price, so it
            works for everything in the closet.
          </p>
          <div className="wear-progress">
            {climbing.map(({ item, stat }) => (
              <div key={item.id} className="wear-row">
                <img src={urls[item.id]} alt={item.name} />
                <div className="wear-row-body">
                  <strong>{item.name}</strong>
                  <div className="bar">
                    <div
                      className="fill good"
                      style={{ width: `${Math.min(100, (stat.count / WEAR_TARGET) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="sub nowrap">
                  {stat.count}/{WEAR_TARGET} · {wearsToTarget(stat)} to go
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>Worth a second look</h3>
        {idle.candidates.length === 0 ? (
          <p className="sub">
            Nothing's gone idle — every piece has either been worn recently or hasn't been in the
            closet long enough to judge.
            {idle.offSeason > 0 &&
              ` ${idle.offSeason} piece${idle.offSeason === 1 ? ' is' : 's are'} sitting out as off-season.`}
          </p>
        ) : (
          <>
            <p className="sub">
              The reverse-hanger trick, minus the hangers: never worn in the three months you've
              owned them, or not worn in the last six.
              {idle.offSeason > 0 &&
                ` ${idle.offSeason} more ${idle.offSeason === 1 ? 'is' : 'are'} idle but the wrong weight for today's weather, so ${idle.offSeason === 1 ? "it's" : "they're"} held back until the season turns.`}
            </p>
            <div className="idle-list">
              {(showAllIdle ? idle.candidates : idle.candidates.slice(0, 5)).map(c => (
                <div key={c.item.id} className="idle-row">
                  <img src={urls[c.item.id]} alt={c.item.name} />
                  <div className="idle-body">
                    <strong>{c.item.name}</strong>
                    <span className="sub">
                      {c.reason === 'never-worn'
                        ? `Never worn in the ${humanDays(c.idleDays)} you've had it`
                        : `Last worn ${humanDays(c.idleDays)} ago`}
                      {c.sunkCost !== null && ` · ${money(c.sunkCost)} paid`}
                    </span>
                  </div>
                  <button
                    className="btn ghost small"
                    onClick={() => onFindInWardrobe(c.item.name)}
                    title="Open this piece in the wardrobe"
                  >
                    Find it
                  </button>
                </div>
              ))}
            </div>
            {idle.candidates.length > 5 && (
              <button className="linkish" onClick={() => setShowAllIdle(v => !v)}>
                {showAllIdle ? 'Show fewer' : `Show all ${idle.candidates.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function CostList({
  title,
  note,
  entries,
  urls,
  currency,
}: {
  title: string
  note: string
  entries: RankedItem[]
  urls: Record<string, string>
  currency: string
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="sub">{note}</p>
      <div className="cpw-list">
        {entries.map(e => (
          <div key={e.item.id} className="cpw-row">
            <img src={urls[e.item.id]} alt={e.item.name} />
            <div className="cpw-body">
              <strong>{e.item.name}</strong>
              <span className="sub">
                {hasPrice(e.item) && `${formatMoney(e.item.price!, currency)} · `}
                {wearSummary(e.stat)}
              </span>
            </div>
            <div className="cpw-figure">
              <strong>{formatMoney(e.costPerWear, currency)}</strong>
              <span className="sub">
                per wear · {e.rank}
                {ordinal(e.rank)} of {e.of} {CATEGORY_LABELS_PLURAL[e.item.category].toLowerCase()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

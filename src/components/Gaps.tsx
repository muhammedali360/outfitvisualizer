import { useMemo } from 'react'
import type { DayPlan, WardrobeItem } from '../types'
import { CATEGORY_ICONS, CATEGORY_LABELS_PLURAL, FORMALITY_LABELS } from '../types'
import { cap } from '../lib/colors'
import { analyzeGaps, TOPS_PER_BOTTOM } from '../lib/gaps'

/**
 * What the closet can't do yet. Everything here is counted rather than
 * asserted — no "you should own 33 things", no capsule template.
 */
export default function Gaps({
  items,
  urls,
  days,
  onGoWardrobe,
}: {
  items: WardrobeItem[]
  urls: Record<string, string>
  days: DayPlan[]
  onGoWardrobe: () => void
}) {
  const report = useMemo(() => analyzeGaps(items, days), [items, days])
  const { coverage, recommendations, coverageGaps, stranded, duplicates, occasions, ratio } = report

  if (coverage.tops === 0 || coverage.bottoms === 0) {
    return (
      <div className="empty-hero">
        <div className="empty-emoji">🧩</div>
        <h2>Not enough to find gaps in yet</h2>
        <p>
          Add a few tops and a few bottoms. Once there's something to combine, this works out which
          pairings actually hold up — and what one more piece would unlock.
        </p>
        <button className="btn primary" onClick={onGoWardrobe}>
          Go to wardrobe
        </button>
      </div>
    )
  }

  const pct = coverage.rate === null ? 0 : Math.round(coverage.rate * 100)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Closet gaps</h1>
          <p className="sub">What your wardrobe can't do yet, and the one piece that would fix it.</p>
        </div>
      </div>

      <div className="card">
        <h3>What actually goes together</h3>
        <div className="coverage-head">
          <strong className="stat-value">{coverage.working}</strong>
          <span className="sub">
            of {coverage.possible} possible top + bottom pairings hold up — {pct}%.
          </span>
        </div>
        <div className="bar tall">
          <div className={`fill ${pct >= 60 ? 'good' : pct >= 35 ? 'ok' : 'bad'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="sub">
          Counted, not multiplied. The usual capsule-wardrobe sum — tops × bottoms × shoes ×
          layers — assumes everything goes with everything, and treats swapping your sneakers for
          loafers as a brand-new outfit. This is every top scored against every pair of bottoms,
          keeping the ones that clear the "you'd actually wear this" bar.
          {report.skipped > 0 &&
            ` ${report.skipped} piece${report.skipped === 1 ? '' : 's'} in the laundry sat this out.`}
        </p>
      </div>

      {recommendations.length > 0 && (
        <div className="card">
          <h3>What would open up the most</h3>
          <p className="sub">
            For every top or pair of bottoms you could plausibly add, how many new working
            pairings it would create. Anything close to something already hanging up is skipped
            first — otherwise the answer is always "buy a black one", since a neutral goes with
            everything and wins on raw count every time. Shoes and jackets aren't ranked here:
            they don't create pairings, they finish ones you can already make, so putting them in
            the same list would compare a garnish against a course.
          </p>
          <div className="rec-grid">
            {recommendations.map(r => (
              <div key={r.label} className="rec-card">
                <span className="rec-swatch" style={{ background: r.hex }} />
                <div className="rec-body">
                  <strong>
                    {CATEGORY_ICONS[r.category]} {cap(r.label)}
                  </strong>
                  <span className="sub">
                    Works with {r.gain} of your {r.of} {r.category === 'top' ? 'bottoms' : 'tops'}
                    {r.rescues > 0 &&
                      ` · rescues ${r.rescues} piece${r.rescues === 1 ? '' : 's'} that pair with almost nothing`}
                  </span>
                </div>
                <span className="rec-gain">+{r.gain}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {coverageGaps.length > 0 && (
        <div className="card">
          <h3>Nothing to finish the outfit</h3>
          <p className="sub">
            Shoes and jackets asked a different way — not "what would open up the most" but "is
            there anything at all to go with what you can already put together".
          </p>
          <ul className="reasons warn">
            {coverageGaps.map((g, i) => (
              <li key={i}>
                {CATEGORY_ICONS[g.category]} {g.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stranded.length > 0 && (
        <div className="card">
          <h3>Pairs with almost nothing</h3>
          <p className="sub">
            The other side of a gap. Sometimes the fix isn't another pair of trousers — it's that
            one piece nothing sits next to.
          </p>
          <div className="idle-list">
            {stranded.slice(0, 6).map(s => (
              <div key={s.item.id} className="idle-row">
                <img src={urls[s.item.id]} alt={s.item.name} />
                <div className="idle-body">
                  <strong>{s.item.name}</strong>
                  <span className="sub">
                    {s.partners === 0 ? 'Works with none' : 'Works with just 1'} of your {s.of}{' '}
                    {s.item.category === 'top' ? 'bottoms' : 'tops'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="card">
          <h3>You already own this</h3>
          <p className="sub">
            Same category, same colour, same weight, same dressiness — for outfit purposes, the same
            piece. Not a problem in itself; just the thing to know before buying another.
          </p>
          <div className="dupe-list">
            {duplicates.slice(0, 5).map((cluster, i) => (
              <div key={i} className="dupe-row">
                <div className="dupe-thumbs">
                  {cluster.items.map(it => (
                    <img key={it.id} src={urls[it.id]} alt={it.name} title={it.name} />
                  ))}
                </div>
                <span className="sub">
                  {cluster.items.length} {cluster.colorName}{' '}
                  {FORMALITY_LABELS[cluster.formality].toLowerCase()}{' '}
                  {CATEGORY_LABELS_PLURAL[cluster.category].toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {occasions && (
        <div className="card">
          <h3>What you own vs. what you reach for</h3>
          <p className="sub">
            Your own log against your own closet. A bar leaning right means you lean on that
            dressiness harder than you own it — you're rotating a small set. Leaning left means it's
            hanging there unused.
          </p>
          <div className="occ-list">
            {occasions.map(o => (
              <div key={o.formality} className="occ-row">
                <span className="occ-label">{FORMALITY_LABELS[o.formality]}</span>
                <div className="occ-bars">
                  <div className="occ-bar">
                    <div className="occ-fill closet" style={{ width: `${o.closetShare * 100}%` }} />
                  </div>
                  <div className="occ-bar">
                    <div className="occ-fill wear" style={{ width: `${o.wearShare * 100}%` }} />
                  </div>
                </div>
                <span className="sub nowrap">
                  {Math.round(o.closetShare * 100)}% owned · {Math.round(o.wearShare * 100)}% worn
                </span>
              </div>
            ))}
          </div>
          <p className="sub legend">
            <i className="key closet" /> share of closet <i className="key wear" /> share of wears
          </p>
        </div>
      )}

      <div className="card">
        <h3>Tops per bottom</h3>
        <p className="sub">
          You have {coverage.tops} top{coverage.tops === 1 ? '' : 's'} to {coverage.bottoms} pair
          {coverage.bottoms === 1 ? '' : 's'} of bottoms
          {ratio.ratio !== null && ` — ${ratio.ratio.toFixed(1)} to 1`}.{' '}
          {ratio.verdict === 'balanced'
            ? `Right around the ${TOPS_PER_BOTTOM}:1 stylists tend to aim for.`
            : ratio.verdict === 'thin-on-tops'
              ? `Stylists tend to aim for about ${TOPS_PER_BOTTOM}:1 — tops carry most of what an outfit looks like, and wear out faster.`
              : `Well past the ${TOPS_PER_BOTTOM}:1 stylists tend to aim for; another pair of bottoms would go further than another top.`}{' '}
          Worth saying plainly: that ratio is a convention repeated by everyone and demonstrated by
          nobody, so treat it as a comparison rather than a target.
        </p>
      </div>
    </section>
  )
}

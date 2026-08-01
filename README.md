# Fit Check 🧥

A virtual wardrobe that lives entirely in your browser. Photograph your clothes,
let the app cut out the background, dress a mannequin, and get outfit advice
from your own closet.

## Features

- **Wardrobe** — upload photos of garments (hat / top / outerwear / bottoms /
  shoes). A clothes-parsing model (SegFormer via Transformers.js, in-browser) labels
  every pixel — Upper-clothes, Pants, Dress, Hat, shoes, plus Face/Hair/skin
  as separate classes — so picking "top" extracts exactly the top's pixels
  with skin and face excluded by construction. A full-outfit photo can be
  added once per piece; the parse is cached, so switching category re-cuts
  instantly. An optional drag-box narrows where to look, and when no distinct
  garment is found (e.g. unusual pieces) it falls back to whole-region
  background removal (`@imgly/background-removal`) with automatic on-device
  face erasure (MediaPipe). Extracted garments are then **normalized** so every
  piece presents uniformly regardless of the photo. Straightening measures the
  shoulder/hip/ear tilt from body pose (MediaPipe, on-device) and falls back to
  the garment's own axis of mirror symmetry, so flat-lays and hanger shots —
  which have no body to read — get straightened too (both capped at ±35°).
  Placement then anchors tops by their shoulder line and bottoms by their
  waistband, scaled so the torso and hips are always the same width; sizing by
  anatomy rather than by bounding box is what stops a cropped tee from
  presenting at the same size as a long coat. Every piece lands on a fixed
  per-category frame matched to the mannequin slots. Dominant colors are
  detected and named.
  Search by name or color, filter by category or availability, and sort by
  newest / name / most- or least-worn. Every piece can be **edited** after the
  fact — rename it, re-file it into another category (which re-normalizes the
  cutout and re-reads its colors), retag its warmth and vibe, or delete it.
- **Laundry** — flag a piece as being in the wash and the stylist, shuffle and
  planner stop reaching for it until you mark it clean. One click from the
  wardrobe card.
- **Outfit Studio** — dress a mannequin by tapping pieces into slots, get a
  live 0–100 score for the combination (color harmony + formality cohesion)
  with plain-English reasons, and save outfits you like. Toggle between the
  flat 2-D view and a rotatable 3-D mannequin (three.js) where your cutouts
  are wrapped onto curved shells around the body — drag to spin, scroll to
  zoom. **Shuffle** deals a random outfit weighted toward ones that actually
  score well, and **"I wore this today"** logs the fit to your wear history.
- **Week** — plan an outfit per day against the 7-day forecast. "Plan the week"
  fills every empty day with a suggestion sized to that day's weather, keeping
  the days varied; or pick per day from the stylist's picks, your saved
  outfits, or whatever's in the studio. Once a day arrives, mark it worn — the
  wear log drives the "worn 3× · 5 days ago" line on every wardrobe card and
  the most/least-worn sorts.
- **Pack** — build a suitcase out of the closet you already own. Give it a
  destination (Open-Meteo's geocoder, free and keyless) and some dates, and it
  fetches the forecast *there* and packs against it. The premise every packing
  guide agrees on is that you pack for **combinations, not for days**, so it
  doesn't pick an outfit per day and add them up — it grows a case one piece at
  a time, always taking whichever top or pair of bottoms adds the most working
  combinations, and preferring on a tie the one that goes with *everything*
  already in the case. Then it deals those combinations across the days, best
  fit for each day's weather, never repeating while a fresh one is left. Tick
  pieces off as they go in; "Copy list" puts the whole thing on the clipboard.
- **Stylist** — "what should I wear today?" Fetches your local forecast from
  Open-Meteo (free, no API key; asks for location permission), filters by how
  the day feels and the occasion (casual / work / dressy), and ranks the best
  combinations from your actual wardrobe. On a cold day it will tell you to put
  a jacket on, and on a warm one that you're carrying too much.

All data (images included) is stored locally in IndexedDB — nothing leaves your
machine except the anonymous weather request, and the destination lookup if you
plan a trip (which tells Open-Meteo a city name, rather less than the browser's
own geolocation tells it).

- **Backup / portability** — "Export backup" in the wardrobe downloads the
  whole closet (garment images, tags, saved outfits, laundry state and the
  calendar/wear log) as one JSON file; "Import backup" restores it on any
  device, browser, or domain. Imports merge by id, so restoring the same file
  twice is harmless, and older v1 backups (without the calendar) still load.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
```

`npm run build` type-checks and produces a production build in `dist/`.

`npm run packcheck` runs the packing-selection check: synthetic closets and
forecasts go through the real trip planner, asserting that the case comes out
smaller than a change of clothes per day, that a trip swinging from 28°C to
1°C carries both ends rather than the average, that a cold trip doesn't leave
the warm jacket behind, and that nothing in the wash ends up in the case.

`npm run normcheck` runs the garment-normalization geometry check: synthetic
tees and pants at assorted rotations, scales and lengths go through the real
pipeline, and the results are measured off their pixels. It also writes
`dev/contact-sheet.png`, which is the quickest way to see the effect of
retuning the canonical frames in `src/lib/normalize.ts`.

## Notes

- The first background removal downloads the segmentation model (~40–80 MB)
  from imgly's CDN; after that it's cached. You can save with the original
  photo while it's still processing, or untick "Use background cutout".
- Weather is optional — if you decline geolocation, pick the "Feels" chips
  (Cold / Mild / Hot) manually.
- Scoring is intentionally transparent and rule-based: dominant-color pairs are
  classified as neutral / tonal / analogous / complementary / clashing, and
  outfit cohesion checks that pieces sit at a similar formality and weight. An
  outer layer counts as extra warmth on top of the top/bottom average, scaled
  by how heavy it is.
- The packing planner never multiplies by shoes. Swapping trainers for loafers
  isn't a new outfit, and counting it as one is what makes published capsule
  numbers look three to five times better than they are; shoes and jackets are
  packed for coverage instead.
- Trips live in localStorage rather than IndexedDB — one working document, not
  a record worth backing up — and the plan is recomputed from the closet every
  time, so it can't go stale against a wardrobe that's moved on.
- The clothes parser has no separate class for outerwear — a jacket is just
  "Upper-clothes" — so a layer is extracted with the same labels as a top and
  told apart by the category you pick.
- Wear counts and last-worn dates aren't stored on the garment; they're derived
  from the day records, so the calendar and your wear history can never drift
  apart.

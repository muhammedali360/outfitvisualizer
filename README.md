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
  face erasure (MediaPipe). Extracted garments are then **normalized**: body
  pose (MediaPipe, on-device) measures the shoulder/hip/ear tilt and the
  garment is rotated upright (capped at ±35°), trimmed, and centered on a
  standard per-category frame so every piece presents uniformly regardless
  of the photo's pose or angle. Dominant colors are detected and named.
  Search by name or color, filter by category or availability, and sort by
  newest / name / most- or least-worn. Every piece can be **edited** after the
  fact — rename it, re-file it into another category (which re-frames the
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
- **Stylist** — "what should I wear today?" Fetches your local forecast from
  Open-Meteo (free, no API key; asks for location permission), filters by how
  the day feels and the occasion (casual / work / dressy), and ranks the best
  combinations from your actual wardrobe. On a cold day it will tell you to put
  a jacket on, and on a warm one that you're carrying too much.

All data (images included) is stored locally in IndexedDB — nothing leaves your
machine except the anonymous weather request.

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
- The clothes parser has no separate class for outerwear — a jacket is just
  "Upper-clothes" — so a layer is extracted with the same labels as a top and
  told apart by the category you pick.
- Wear counts and last-worn dates aren't stored on the garment; they're derived
  from the day records, so the calendar and your wear history can never drift
  apart.

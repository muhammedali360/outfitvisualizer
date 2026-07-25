# Fit Check 🧥

A virtual wardrobe that lives entirely in your browser. Photograph your clothes,
let the app cut out the background, dress a mannequin, and get outfit advice
from your own closet.

## Features

- **Wardrobe** — upload photos of garments (hat / top / bottoms / shoes).
  A clothes-parsing model (SegFormer via Transformers.js, in-browser) labels
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
- **Outfit Studio** — dress a mannequin by tapping pieces into slots, get a
  live 0–100 score for the combination (color harmony + formality cohesion)
  with plain-English reasons, and save outfits you like. Toggle between the
  flat 2-D view and a rotatable 3-D mannequin (three.js) where your cutouts
  are wrapped onto curved shells around the body — drag to spin, scroll to
  zoom.
- **Stylist** — "what should I wear today?" Fetches your local forecast from
  Open-Meteo (free, no API key; asks for location permission), filters by how
  the day feels and the occasion (casual / work / dressy), and ranks the best
  combinations from your actual wardrobe.

All data (images included) is stored locally in IndexedDB — nothing leaves your
machine except the anonymous weather request.

- **Backup / portability** — "Export backup" in the wardrobe downloads the
  whole closet (garment images, tags, saved outfits) as one JSON file;
  "Import backup" restores it on any device, browser, or domain. Imports merge
  by id, so restoring the same file twice is harmless.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
```

`npm run build` type-checks and produces a production build in `dist/`.

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
  outfit cohesion checks that pieces sit at a similar formality and weight.

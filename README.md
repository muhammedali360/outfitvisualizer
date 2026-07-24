# Fit Check 🧥

A virtual wardrobe that lives entirely in your browser. Photograph your clothes,
let the app cut out the background, dress a mannequin, and get outfit advice
from your own closet.

## Features

- **Wardrobe** — upload photos of garments (hat / top / bottoms / shoes).
  After picking a photo you drag a box over the garment so the cutout only
  looks there — a full-outfit photo can be added once per piece. The
  background is then removed in the browser (via `@imgly/background-removal`,
  no server involved), any detected face is automatically erased from the
  cutout (MediaPipe face detection, also on-device — untick to keep it),
  transparent margins are auto-trimmed so pieces fill their mannequin slots,
  and dominant colors are detected and named.
- **Outfit Studio** — dress an SVG mannequin by tapping pieces into slots, get
  a live 0–100 score for the combination (color harmony + formality cohesion)
  with plain-English reasons, and save outfits you like.
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

## Notes

- The first background removal downloads the segmentation model (~40–80 MB)
  from imgly's CDN; after that it's cached. You can save with the original
  photo while it's still processing, or untick "Use background cutout".
- Weather is optional — if you decline geolocation, pick the "Feels" chips
  (Cold / Mild / Hot) manually.
- Scoring is intentionally transparent and rule-based: dominant-color pairs are
  classified as neutral / tonal / analogous / complementary / clashing, and
  outfit cohesion checks that pieces sit at a similar formality and weight.

# anki-local

Offline-first PWA that imports Anki `.apkg` / `.colpkg` files and reviews them with FSRS or SM-2 scheduling.
Runs on iOS Safari (Add to Home Screen) and desktop. No backend.

## Dev
```
npm i
npm run dev          # http://localhost:5173
npm test             # vitest
npm run typecheck
npm run build        # dist/ with service worker
npx tsx test/gen-fixtures.ts   # writes test/fixtures/*.apkg for manual import
```

## Import sources
- Local file picker (on iOS this includes iCloud Drive).
- Google Drive: copy `.env.example` to `.env.local`, set `VITE_GOOGLE_CLIENT_ID` (OAuth web client) and `VITE_GOOGLE_API_KEY` (Picker).

## Deploy
Pushing to `main` runs `.github/workflows/pages.yml` and publishes `dist/` to GitHub Pages under `/<repo>/`.
Enable Pages with source "GitHub Actions" in the repo settings once.

## License
GNU AGPL v3 or later. See [LICENSE](LICENSE).

Most of `src/scheduler/` and `src/render/` are TypeScript ports of [Anki](https://github.com/ankitects/anki)
(`rslib/src/scheduler`, `rslib/src/template.rs`, `rslib/src/cloze.rs`, `rslib/src/typeanswer.rs`,
`rslib/src/card_rendering`, `ts/reviewer`, `qt/aqt/reviewer.py`), copyright Ankitects Pty Ltd and
contributors, AGPL-3.0-or-later. Each ported file names its upstream source in its header.
`src/scheduler/fsrs.ts` ports the forward pass of [fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) (BSD-3-Clause).
This project is not affiliated with Ankitects.

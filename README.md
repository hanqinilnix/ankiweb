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

`src/scheduler/sm2.ts` is a TypeScript port of the scheduler in
[Anki](https://github.com/ankitects/anki) (`rslib/src/scheduler/states/`), copyright Ankitects Pty Ltd
and contributors, AGPL-3.0-or-later. Package and database formats follow Anki's `rslib/src/import_export`
and `rslib/src/storage`. FSRS scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT).
This project is not affiliated with Ankitects.

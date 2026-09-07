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

## License
AGPL-3.0. Format and scheduler behaviour follow https://github.com/ankitects/anki.

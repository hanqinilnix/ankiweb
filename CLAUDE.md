# anki-local — Anki-compatible PWA

## Goal
Offline-first PWA that opens on iOS Safari (Add to Home Screen) and desktop. Imports existing Anki
collections (.apkg / .colpkg) from local files, iCloud Drive, or Google Drive, and lets the user
review cards with Anki-faithful scheduling. Not a full Anki clone: no sync server, no add-on system.

Reference implementation: https://github.com/ankitects/anki (AGPL). Read it for formats and
scheduler behaviour; do not copy code verbatim unless we accept AGPL for this repo (we do, keep the
LICENSE file AGPL-3.0 and attribute).

## Stack (decided, do not relitigate)
- TypeScript, Vite, React 19, vanilla CSS. No UI framework.
- `sql.js` (SQLite compiled to WASM) to read `collection.anki2` / `collection.anki21`.
- `fzstd` to decompress `collection.anki21b` and zstd-compressed media in newer exports.
- `jszip` (or `fflate`) to unpack the .apkg zip.
- IndexedDB (via `idb`) for the app's own store. Do NOT keep the SQLite DB as the live store;
  import once into IndexedDB, then run entirely on our own schema.
- `vite-plugin-pwa` for manifest + service worker. Cache-first for app shell, never cache API calls.
- Tests: Vitest. Scheduler and importer must be unit-tested against fixtures in `test/fixtures/`.
- No backend. Google Drive access is browser-side OAuth only.

## Layout
```
src/
  app/            routing, shell, PWA registration
  import/         apkg unpack, SQLite read, Anki schema -> our model
  model/          TS types for Deck, Note, NoteType, Card, RevlogEntry, Config
  store/          IndexedDB access layer (idb), migrations
  scheduler/      FSRS + legacy SM-2 port, pure functions, no IO
  render/         card template rendering ({{Field}}, {{cloze:}}, {{hint:}}, {{type:}}), media URLs
  cloud/          providers: local file picker, iCloud (via Files picker), Google Drive
  ui/             React components
test/fixtures/    small .apkg files covering: basic, cloze, media, anki21b/zstd, FSRS-enabled
```

## Anki format facts (verify against upstream before changing)
- `.apkg` is a zip. Contains one of:
  - `collection.anki2`  (schema 11, legacy, SQLite)
  - `collection.anki21` (schema 11, SQLite, Anki 2.1.x)
  - `collection.anki21b` (schema 18, SQLite, zstd-compressed, Anki 2.1.50+). Prefer this when present.
  - `media` file: JSON map `{"0":"filename.jpg", ...}` in legacy; protobuf `MediaEntries` and
    zstd-compressed in 21b. Media blobs are files named `0`, `1`, ... in the zip.
- `.colpkg` is the same structure but a whole collection export.
- Key tables: `col` (single row: crt, mod, scm, conf, models, decks, dconf as JSON in schema 11;
  separate `notetypes`, `decks`, `deck_config`, `fields`, `templates`, `config` tables in schema 18),
  `notes` (id, guid, mid, mod, usn, tags, flds, sfld, csum), `cards` (id, nid, did, ord, type,
  queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data), `revlog`
  (id, cid, usn, ease, ivl, lastIvl, factor, time, type), `graves`.
- `notes.flds` is fields joined by `\x1f`. Field order comes from the notetype.
- Card `type`: 0 new, 1 learning, 2 review, 3 relearning. `queue`: -3 sched buried, -2 user buried,
  -1 suspended, 0 new, 1 learn, 2 review, 3 day-learn, 4 preview.
- `due` semantics depend on type: new = position, learn = epoch seconds, review = days since `col.crt`.
- `cards.data` JSON may hold FSRS state: `s` (stability), `d` (difficulty), `dr` (desired retention).
- Timestamps: `col.crt` is epoch seconds of collection creation; "day" boundaries use the deck
  config `rollover` hour (default 4am), not midnight.
- Upstream source to read: `rslib/src/import_export/package/`, `rslib/src/storage/`,
  `rslib/src/scheduler/`, `rslib/src/card/`, `rslib/src/notetype/`, `rslib/src/template.rs`,
  `rslib/src/cloze.rs`. Schema SQL in `rslib/src/storage/schema*.sql`.

## Scheduler
- Default to FSRS (Anki 23.10+ default). Port from `rslib/src/scheduler/fsrs/` or use the
  `ts-fsrs` package if its output matches upstream within tolerance on fixtures. Decide by test.
- Also implement SM-2 ("v3 scheduler" behaviour) for collections without FSRS state so imported
  intervals continue sanely. Keep both behind one `Scheduler` interface.
- Scheduler functions are pure: `(card, revlog, config, now) -> next states`. No Date.now() inside.
- Write `revlog` entries on every answer; never mutate history.

## Import sources
- Local: `<input type="file" accept=".apkg,.colpkg">`. On iOS this opens the Files app, which
  already exposes iCloud Drive, so iCloud needs no SDK. Also accept drag-and-drop on desktop.
- Google Drive: Google Identity Services (GIS) token client + Google Picker API, scope
  `drive.file` (per-file, no broad access). Download via `drive.files.get?alt=media`.
  Client ID lives in `.env.local` as `VITE_GOOGLE_CLIENT_ID`; never commit it.
- File System Access API is not available on iOS Safari. Do not depend on it.
- Import is idempotent by `notes.guid` and card `(nid, ord)`. Re-import merges, never duplicates.
- Large files: unzip and read in a Web Worker; stream media blobs into IndexedDB one at a time.
  iOS Safari kills tabs that spike memory, so never hold all media in RAM.

## Card rendering
- Support `{{Field}}`, `{{#Field}}...{{/Field}}`, `{{^Field}}...{{/Field}}`, `{{cloze:Field}}`,
  `{{hint:Field}}`, `{{type:Field}}`, `{{FrontSide}}`, `{{Tags}}`, `{{Deck}}`, `{{Card}}`.
- Render inside a sandboxed iframe (`sandbox="allow-scripts"` only when template has script).
  Anki templates can contain arbitrary JS and CSS; keep that away from the app document.
- Media: `[sound:x.mp3]` becomes an audio element; `<img src="x.jpg">` resolves to a blob URL from
  IndexedDB. MathJax lazy-loaded only when `\(`, `\[`, or `[$]` appears.

## iOS PWA constraints
- No push, no background sync. Do not build features that need them.
- IndexedDB may be evicted after ~7 days of disuse unless installed to Home Screen. Tell the user
  to install; offer export of progress as `.apkg`-compatible revlog so nothing is lost.
- Audio autoplay requires a user gesture; play answer audio on the reveal tap, not on timer.
- `100vh` is wrong on iOS Safari; use `100dvh`.

## Conventions
- Small pure modules. Anything touching IndexedDB or the network lives in `store/` or `cloud/`.
- Every importer change needs a fixture and a test. Every scheduler change needs a table-driven
  test with expected intervals.
- Commit messages: conventional (`feat:`, `fix:`, `test:`, `chore:`).
- Run `npm test` and `npm run typecheck` before declaring work done.
- Do not add dependencies without a one-line justification in the PR/commit body.

## Out of scope (v1)
AnkiWeb sync, add-ons, note editing beyond tags/flags, deck options UI beyond retention slider,
image occlusion note type.

## Style (user rule)
Concise everywhere: code, comments, docs, chat replies. No filler, no restating, no long explanations.
Code: small functions, no speculative abstractions, comments only where intent is non-obvious.

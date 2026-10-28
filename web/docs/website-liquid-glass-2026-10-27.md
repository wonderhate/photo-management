# Public website: local Liquid Glass preview

This update belongs to `photo_collection_web`, the source for the deployed photography website and `/windows.html`. It is a local UI change; no hosting, DNS, release binary, or production download metadata was changed.

The shared material lives in `frontend/public/site-glass.css`. Its selectors cover the public homepage, gallery, photograph information panel, bilingual About and Lumina introductions, and the Windows/Linux download page. They do not style the browser-local library. The existing page structure, text, fonts, photography and native download links are retained.

`frontend/public/site-glass.js` uses delegated pointer events and one animation frame at a time to position a soft highlight on the nearest glass surface. Scrolling, leaving the window, losing focus and visibility changes clear the highlight. Reduced motion, reduced transparency, increased contrast, forced colors and coarse pointers disable tracking. Keyboard focus remains visible, and increased contrast or reduced transparency uses opaque surfaces. Photograph pixels are not blurred or recolored.

HTML entry points and the static introduction generator load both assets. The service-worker version includes their contents, and the offline shell caches them; public photographs, the mutable portfolio manifest and installer downloads remain outside that cache.

## Preview

Run `npm run build` to rebuild the public website using its existing remembered selection, then `npm run preview:showcase`. The local addresses are:

- `http://127.0.0.1:4176/`
- `http://127.0.0.1:4176/about/`
- `http://127.0.0.1:4176/lumina/`
- `http://127.0.0.1:4176/windows.html`

English introduction pages remain under `/en/`. The source is on `codex/website-liquid-glass`; deployment requires a separate owner action.

## Verification

- `npm test`: 16 tests passed.
- `npm run build` and `npm run build:web`: passed.
- `npm run test:showcase`: 14 tests passed, including six new glass checks for lighting cleanup, information panels, dark/light themes, mobile layouts, runtime accessibility preferences and offline assets.
- `node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.web.config.ts web-download.spec.mjs`: two tests passed, including synthetic direct/fallback downloads and preservation of a browser-local library.
- Browser automation used the existing synthetic two-image export via a test-only `PHOTO_PORTFOLIO_CONFIG`. The normal public build was restored afterwards without changing the remembered publication source.

The download regression now scopes the Windows version assertion to its Windows section, since the existing page also has a Linux version label. Screenshots, logs, fixtures and generated builds stay in ignored locations.

## Follow-up: smaller light and deferred library selection

The pointer-light ellipse now uses radii of 140 × 86.6667 CSS pixels, one third of the previous 420 × 260. Static ambient backgrounds retain their size.

The browser-local start screen now has Chinese/English skip controls. Skipping creates only an empty in-memory read model, with no chosen data directory or photo access. On an import action, the same library choices appear in a keyboard-accessible modal. Choosing a new or existing library mounts the real library and opens the import dialog directly; cancelling returns focus to the initiating control. A skipped session does not show the first-use onboarding dialog or run the initial scan request.

Actual mutations, storage commits, backups and file operations still require a real library. General save actions prompt for a library and explain that the action must then be repeated. The darkroom also requires a library before opening a photo, so choosing a library cannot discard an editing session. Existing library formats and original-file handling are unchanged.

Follow-up validation: `npm test` passes 16 tests; the full `npm run test:web` suite passes 35 with five existing RAW fixture tests skipped because the documented samples are absent. Five new browse-flow cases cover no-permission browsing, cancellation and retries, new/existing libraries, persisted synthetic imports, original hashes, English mobile layout and keyboard focus. The public showcase suite still passes 14, including computed light-radius checks.

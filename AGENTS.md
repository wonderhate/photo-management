# Working on PhotoCollection

Read `docs/development-handoff-2026-10-13.md` and `CONTRIBUTING.md` before continuing development. Current application version: 2.6.0; supported products: Windows desktop and local web.

- Original photos are read-only. Removing library records, people, drafts or generated artworks must never delete or overwrite originals. Use synthetic fixtures for automated tests.
- Keep personal databases, model weights, keys, logs, screenshots and `.local-notes/` out of Git and release artifacts. Preserve bundled font licenses and asset source records.
- Bind local desktop/source services to loopback. Android, iOS, pairing, remote access and the Express prototype are retired; restoring them requires a new user request.
- Reuse existing services and installed dependencies. Avoid changing application behavior during documentation or repository cleanup.
- Watercolor uses the configured Qwen endpoint and a separate credential. Do not reuse OpenAI credentials or automatically upload photos, call paid generation, or retry billable requests.
- Changes to schema, storage migration, image rendering or exports need relevant regression checks, including original-file hashes where applicable.
- Keep Chinese and English UI text aligned. Use current theme variables and preserve reduced-motion behavior.
- Windows PowerShell scripts containing non-ASCII text need UTF-8 BOM for PowerShell 5.1.
- Isolate test libraries under `.test-artifacts/`; installer verification refuses to overwrite an existing registered installation.
- Use `codex/` feature branches. Inspect remote changes before integration, avoid force-pushes, and do not reset other worktrees.

Baseline checks: `npm test`, `npm run test:frontend`, `npm run build`, `npm run test:browser`, and `.venv/Scripts/python.exe -m unittest desktop.test_icon`.

# Lumina Web

This is the independent browser application repository. The Windows desktop application and its history remain in the original repository.

- Read README.md before developing. Preserve browser-local storage, original-file read-only behavior, Chinese/English UI, themes and accessibility.
- Never commit personal libraries, photos, credentials, `.env` files, dependencies, generated builds or test artifacts. Use only synthetic fixtures in tests.
- Browser assets live in `assets/`; retain font licenses and asset source records. No desktop backend is required.
- AI requests require explicit confirmation. Never upload personal photos, call paid generation or automatically retry billable requests during tests.
- Check `npm test`, `npm run build`, and relevant browser/relay regressions. Use `PHOTO_TEST_PYTHON` when the Python environment is elsewhere. Build public exports with `npm run build:showcase`.
- Use `codex/` for feature branches. Keep deployment and remote Git publication separate from local commits.

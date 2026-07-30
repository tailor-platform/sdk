---
"@tailor-platform/sdk": patch
---

Tell you when a config resolves without an `id`, and stop the commands that need one from misreporting what they did.

Which application owns a deployed resource is decided by the application id recorded on it. `deploy` writes an `id` into your config so this keeps working, but only into an inline `defineConfig({...})` call — a config that re-exports one from another file resolves without an id, and nothing said so. `remove` and a local `--dry-run` also run without one.

- The recorded id is now cleared when the config has none, so ownership settles after one deploy. Previously it was left in place, so the next deploy again saw the resources as another application's and again asked to re-tag them; `--yes` silenced the prompt without settling anything, and CI failed outright because the prompt cannot be answered there.
- Commands that decide ownership now warn when the config resolved without an id, and say how to add one.
- That prompt no longer claims the id "was regenerated" when the config simply has none. It now says ownership falls back to the application name and asks whether to proceed on that basis.
- `remove` no longer reports that it removed everything when it skipped resources tagged with your application name that it could not prove it owns. It says what was left behind and why.

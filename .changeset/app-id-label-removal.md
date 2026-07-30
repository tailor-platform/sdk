---
"@tailor-platform/sdk": patch
---

Stop `deploy` from asking to re-tag the same resources on every run when the config resolves without an `id`.

Which application owns a deployed resource is decided by the application id recorded on it. A deploy that runs without an id — a `tailor.config.ts` that re-exports `defineConfig()` from another file, or a local `--dry-run` — left the recorded id untouched, so the next deploy saw those resources as belonging to a different application and asked to re-tag them again. `--yes` silenced the prompt without settling anything, and in CI the deploy failed outright because the prompt cannot be answered there. The recorded id is now cleared when the config has none, so one deploy is enough to settle it.

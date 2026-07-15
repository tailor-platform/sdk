---
"@tailor-platform/sdk": minor
---

Once `tailor.config.ts`'s `id` has been resolved and `tailor.d.ts` regenerated (`tailor-sdk deploy`/`generate`), `defineConfig()` now requires the `id` field at typecheck time, catching an accidental removal in your editor instead of at deploy time.

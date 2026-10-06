---
"@tailor-platform/sdk-plugin-safeql": minor
---

Add `@tailor-platform/sdk-plugin-safeql` to check raw SQL against your TailorDB tables with SafeQL. `safeqlPlugin()` generates an ESLint config from your tables on `tailor generate`, the `sql` tag builds parameterized statements for `tailordb.Client`, and `transaction` runs statements between `BEGIN` and `COMMIT`

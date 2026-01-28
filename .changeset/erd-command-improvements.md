---
"@tailor-platform/sdk": patch
---

fix: improve ERD command UX

- Allow `erd export` and `erd serve` to work without `erdSite` configuration (only `erd deploy` requires it)
- Suppress verbose liam CLI output during ERD build
- Improve `erd export` log output with success message for build path

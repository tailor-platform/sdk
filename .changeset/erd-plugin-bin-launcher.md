---
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Resolve the `tailor-tailordb-erd` bin through a committed launcher so package managers link it even when `dist/` has not been built yet (pnpm skips bins whose target file does not exist at install time).

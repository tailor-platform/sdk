---
"@tailor-platform/sdk": patch
---

Fix `tailor` CLI failing with `ERR_MODULE_NOT_FOUND` when resolving `tsconfig.json` path aliases (`compilerOptions.paths`) in projects that omit `baseUrl`, which is the standard style since TypeScript 5.0.

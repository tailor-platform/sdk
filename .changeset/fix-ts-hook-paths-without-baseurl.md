---
"@tailor-platform/sdk": patch
---

Fix `tailor` CLI failing with `ERR_MODULE_NOT_FOUND` when resolving `tsconfig.json` path aliases (`compilerOptions.paths`) in projects that omit `baseUrl`, which is the standard style since TypeScript 5.0. Also fix path alias resolution to match TypeScript's `extends` behavior: a child config's `baseUrl` is now correctly inherited from an extended config, and a child config's own `paths` now replaces (rather than merges with) inherited `paths`.

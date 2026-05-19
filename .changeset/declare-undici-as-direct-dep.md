---
"@tailor-platform/sdk": patch
---

Declare `undici` as a direct dependency. The SDK CLI imports `getGlobalDispatcher` from `undici`, but the package was previously available only through accidental hoisting of a transitive dependency. Strict node_modules layouts (e.g. pnpm 11 with stricter hoisting) would fail to resolve the import; declaring it directly fixes that.

---
"@tailor-platform/sdk-codemod": patch
---

Remove the unreferenced `src/helpers.ts` module. It was never exported from the package, so `parseTS`/`parseTSX` were unreachable; codemod transforms parse with `@ast-grep/napi` directly.

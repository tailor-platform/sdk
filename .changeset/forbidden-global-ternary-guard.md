---
"@tailor-platform/sdk": patch
---

Fix `FORBIDDEN_RUNTIME_GLOBAL` wrongly rejecting bundles that use the UMD environment-detection ternary `typeof global !== "undefined" ? global : ...`

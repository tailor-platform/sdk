---
"@tailor-platform/sdk": patch
---

Fix `FORBIDDEN_RUNTIME_GLOBAL` wrongly rejecting workflow jobs and executors whose dependencies detect the environment with `typeof global !== "undefined" ? global : ...`, including after the bundle is minified

---
"@tailor-platform/sdk": patch
---

Fix `FORBIDDEN_RUNTIME_GLOBAL` wrongly rejecting workflow jobs and executors whose dependencies detect the environment with `typeof` ternaries such as `typeof global !== "undefined" ? global : ...` or `typeof window === "undefined" ? {} : window`, including after the bundle is minified

---
"@tailor-platform/sdk": patch
---

Fix `FORBIDDEN_RUNTIME_GLOBAL` wrongly rejecting workflow jobs and executors whose dependencies detect the environment with `typeof` ternaries such as `typeof global !== "undefined" ? global : ...` or `typeof window === "undefined" ? {} : window`, including after the bundle is minified

Fix TailorDB hooks and validators dropping a constant from the same file when they read it behind a `typeof` check such as `typeof DEFAULT_VALUE !== "undefined" && DEFAULT_VALUE`

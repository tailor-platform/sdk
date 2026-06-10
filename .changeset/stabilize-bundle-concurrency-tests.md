---
"@tailor-platform/sdk": patch
---

Stabilize the `withBundleConcurrency` unit tests by driving their worker delays with fake timers instead of real `setTimeout`, so they no longer flake with a 5s timeout when a CI runner is under load. No runtime behavior changes.

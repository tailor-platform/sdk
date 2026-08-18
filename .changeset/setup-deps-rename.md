---
"@tailor-platform/sdk": minor
---

`tailor setup renovate` is renamed to `tailor setup deps`, which takes the dependency update provider as `--provider` (currently `renovate`, the default). The old name keeps working as a deprecated alias until v3 and prints a deprecation warning when used.

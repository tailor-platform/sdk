---
"@tailor-platform/sdk": minor
---

`tailor setup renovate` is renamed to `tailor setup deps`. The command still generates a Renovate config that extends Tailor's shared preset; the concept-level name leaves room for other dependency update providers. The old name keeps working as a deprecated alias until v3 and prints a deprecation warning when used.

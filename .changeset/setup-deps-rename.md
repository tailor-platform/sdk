---
"@tailor-platform/sdk": minor
---

`tailor setup renovate` is renamed to `tailor setup deps`. The command still generates a Renovate config that extends Tailor's shared preset; the concept-level name leaves room for other dependency update providers. `setup` is a beta command, so the old name is removed without an alias.

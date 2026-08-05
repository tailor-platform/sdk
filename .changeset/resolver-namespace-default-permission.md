---
"@tailor-platform/sdk": minor
---

Add `defaultPermission` to resolver namespaces in `defineConfig`, applying an access requirement to every resolver in the namespace that declares no `permission` of its own — securing a namespace no longer means editing every resolver. It takes the same values as a resolver's `permission`, including `"allowAnonymous"` for a namespace that is public by design, and a resolver's own `permission` replaces it rather than merging with it. `generate` and `deploy` now warn when a namespace declares neither a `defaultPermission` nor a `permission` on each of its resolvers.

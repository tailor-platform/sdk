---
"@tailor-platform/sdk": minor
---

`tailor deploy -c a,b` now resolves an `idpUser` trigger's `idp` to an IdP owned by another config in the same run, so the subscribing config no longer needs to declare that IdP with `external: true` in `defineConfig({ idp })`. The `idpUser` triggers also accept `external: true` next to `idp` to name an IdP the config does not declare without a type error. Triggers that omit `idp` and single-config deploys behave as before.

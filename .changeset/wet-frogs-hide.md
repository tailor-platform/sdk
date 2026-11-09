---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `mockSecretmanager` now makes `getSecret()` and `getSecrets()` reject with a `vault not found: <vault>` error for a vault it was not given, as they do on the Platform, instead of resolving `undefined` or `{}`. A missing secret in an existing vault still resolves to `undefined` and is omitted from `getSecrets()`. A test that reads a vault it never seeded now fails; seed the vault with `mockSecretmanager({ secrets: { "<vault>": { ... } } })`, or with `{}` to test a missing secret. `tailorRuntime({ config })` seeds only the vaults declared in `defineSecretManager()`, so also seed vaults created with `tailor secret vault create` and the vaults `tailor deploy` creates for IdP clients. `setSecrets()` replaces and `reset()` clears config-loaded vaults too, so a test that calls them and then reads a config vault now fails; use `setSecret()` or `mergeSecrets()` to add values while keeping those vaults.

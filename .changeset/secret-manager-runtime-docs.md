---
"@tailor-platform/sdk": patch
---

Fix `packages/sdk/docs/services/secret.md`'s runtime-access guidance for Secret Manager: reading a secret from a resolver, executor, or workflow via the `secrets` object exported by `defineSecretManager()` fails to build with `FORBIDDEN_RUNTIME_GLOBAL (process)` once any vault value comes from `process.env`, because that object also carries the raw config values into the deployed bundle. The docs now recommend `secretmanager.getSecret()` / `getSecrets()` from `@tailor-platform/sdk/runtime` instead, which never touches the config object.

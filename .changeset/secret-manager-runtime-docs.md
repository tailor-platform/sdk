---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": patch
---

Fix the Secret Manager runtime-access guidance: reading a secret from a resolver, executor, or workflow via the `secrets` object exported by `defineSecretManager()` fails to build with `FORBIDDEN_RUNTIME_GLOBAL (process)` once any vault value comes from `process.env`, because that object also carries the raw config values into the deployed bundle. The docs now recommend `secretmanager.getSecret()` / `getSecrets()` from `@tailor-platform/sdk/runtime` instead, which never touches the config object.

`defineSecretManager()`'s `get()` / `getAll()` methods are now `@deprecated` for the same reason and will be removed in a future major version; a codemod (`v3/secrets-get-to-secretmanager`) is registered to guide the migration.

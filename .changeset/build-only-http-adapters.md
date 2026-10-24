---
"@tailor-platform/sdk": patch
---

Internal: the build-only result of `deploy`, used by the SDK's own tests, now also includes HTTP adapter bundles grouped by application name. A build-only deploy now rejects two configs that share an application name and both define HTTP adapters, which a regular deploy already rejects.

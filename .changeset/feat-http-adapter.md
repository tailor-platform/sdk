---
"@tailor-platform/sdk": minor
---

Add `defineHttpAdapter()` for declaring HTTP adapters that translate HTTP requests into GraphQL queries and reshape the responses. Adapter files are discovered via the new `httpAdapter.files` glob in `defineConfig()`. At deploy time the `input`/`output` functions are bundled and embedded as gateway filters on the application. Requires the per-workspace feature flag `20260413_platform_filter_router` to be enabled before adapter routes serve traffic.

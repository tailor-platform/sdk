---
"@tailor-platform/sdk": minor
---

Add `createHttpAdapter()` for declaring HTTP adapters that translate HTTP requests into GraphQL queries and reshape the responses. Adapter files are discovered via the new `httpAdapter.files` glob in `defineConfig()`.

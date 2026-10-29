---
"@tailor-platform/sdk": patch
---

The SDK no longer installs `graphql`, `@urql/core`, or `wonka` as dependencies. The `DocumentNode` type that HTTP adapter `input` handlers and the executor `query` option accept is now included in the SDK's type declarations, so a project without `graphql` still gets `query` type-checked, and documents typed with `graphql` 16 or 17, including `TypedDocumentNode`, keep type-checking. If your project imports `graphql`, `@urql/core`, or `wonka` without declaring it, which only works when your package manager hoists it, add it to your own dependencies. If you use `graphql` 15 with `skipLibCheck: true`, passing a `parse()` result to the executor `query` option is now a type error, as it already was for HTTP adapters.

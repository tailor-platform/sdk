---
"@tailor-platform/sdk": patch
---

The SDK no longer installs `graphql` as a dependency. The `DocumentNode` type that HTTP adapter `input` handlers accept is now included in the SDK's type declarations, so documents typed with `graphql` 16 or 17, including `TypedDocumentNode`, keep type-checking without the SDK bringing its own copy. If your project imports `graphql` but only had it through the SDK, add it to your own dependencies.

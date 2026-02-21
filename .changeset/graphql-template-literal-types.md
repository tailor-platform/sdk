---
"@tailor-platform/sdk": minor
---

Add type-safe GraphQL variable inference for executor operations

- Add GraphQL type inference module (`@tailor-platform/sdk/graphql`) with `ExtractRootField`, `InferCreateInput`, `InferUpdateInput`, `InferGqlResult`, and `GeneratedGqlSchema` module augmentation
- Executor `query` field now preserves template literal types via `const Q` generic, enabling automatic variable type resolution from `GeneratedGqlSchema`
- Add `StrictKeys` for excess property checking on `variables` callback return values
- Remove `@urql/core` dependency in favor of plain string-based GraphQL queries

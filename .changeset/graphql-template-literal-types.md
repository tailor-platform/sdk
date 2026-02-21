---
"@tailor-platform/sdk": minor
---

Add type-safe GraphQL variable inference for executor operations

- GraphQL queries written as template literals in `createExecutor` now infer variable types from the generated schema at compile time
- Add `@tailor-platform/graphql-schema` builtin generator for schema type declarations
- Add `@tailor-platform/sdk/graphql` export with type utilities (`ValidateGqlQuery`, `GqlVariables`, `GqlResult`, etc.)
- Remove `@urql/core` dependency in favor of plain string queries

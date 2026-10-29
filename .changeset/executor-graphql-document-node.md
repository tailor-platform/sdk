---
"@tailor-platform/sdk": patch
---

An executor whose GraphQL operation passes a `DocumentNode`, such as the result of `parse()` from `graphql` or a `gql` tagged template, to `query` now deploys it as the printed GraphQL query. It was deployed as the text `[object Object]`, which is not a valid GraphQL query. Passing the query as a string is unchanged.

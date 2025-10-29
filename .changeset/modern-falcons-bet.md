---
"@tailor-platform/tailor-sdk": patch
"@tailor-platform/create-tailor-sdk": patch
---

feat!: unnest resolver input type

## Breaking Changes

The structure of resolver input arguments in GraphQL queries/mutations has changed. Previously, all input fields were nested under a single `input` argument, but now they are passed as flat, top-level arguments.

### Migration Guide

You have two migration options:

#### Option 1: Update GraphQL queries

Update your GraphQL queries to pass arguments as flat parameters.

**Before:**

```gql
query {
  add(input: { a: 1, b: 2 }) {
    result
  }
}
```

**After:**

```gql
query {
  add(a: 1, b: 2) {
    result
  }
}
```

#### Option 2: Wrap input type to maintain existing GraphQL API

If you need to maintain backward compatibility with existing GraphQL queries, wrap your input type in a single `input` field:

```typescript
createResolver({
  name: "add",
  operation: "query",
  input: t.type({
    input: t.object({
      a: t.int(),
      b: t.int(),
    }),
  }),
  body: (context) => {
    return { result: context.input.input.a + context.input.input.b };
  },
  output: t.type({ result: t.int() }),
});
```

This way, your existing GraphQL queries with `add(input: { a: 1, b: 2 })` will continue to work.

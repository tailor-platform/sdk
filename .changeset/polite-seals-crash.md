---
"@tailor-platform/create-tailor-sdk": minor
"@tailor-platform/tailor-sdk": minor
---

feat!: remove TailorType and set typename for resolver

## Breaking Changes

### Removed `t.type()` - use plain objects for input and `t.object()` for output

The `t.type()` wrapper has been removed from resolver definitions. Input fields are now passed directly as an object, and output uses `t.object()` instead.

**Before:**

```typescript
createResolver({
  name: "add",
  operation: "query",
  input: t.type({
    a: t.int(),
    b: t.int(),
  }),
  output: t.type({
    result: t.int(),
  }),
  body: (context) => {
    return { result: context.input.a + context.input.b };
  },
});
```

**After:**

```typescript
createResolver({
  name: "add",
  operation: "query",
  input: {
    a: t.int(),
    b: t.int(),
  },
  output: t.object({
    result: t.int(),
  }),
  body: (context) => {
    return { result: context.input.a + context.input.b };
  },
});
```

## New Feature

### Added `typeName()` method for custom GraphQL type names

You can now set custom GraphQL type names for enum and nested object fields using the `.typeName()` method. This is useful when you want to control the generated GraphQL type names.

```typescript
createResolver({
  name: "stepChain",
  operation: "query",
  input: {
    user: t
      .object({
        name: t.object({
          first: t.string(),
          last: t.string(),
        }),
        activatedAt: t.datetime({ optional: true }),
      })
      .typeName("StepChainUser"),
  },
  output: t.object({
    result: t.string(),
  }),
  body: (context) => {
    return {
      result: `${context.input.user.name.first} ${context.input.user.name.last}`,
    };
  },
});
```

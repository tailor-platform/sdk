---
"@tailor-platform/tailor-sdk": minor
---

Aligned `createExecutor` interface with `createResolver`

**Breaking Changes:**

`createExecutor` interface has changed significantly.
Previously, it was defined by chaining `.on` and `.executeFunction`, but it's been changed to simply pass an object similar to `createResolver`.

before:

```typescript
createExecutor("executor-name", "Executor description")
  .on(recordCreatedTrigger(user, ({ newRecord }) => newRecord.age < 18))
  .executeFunction({
    fn: async ({ newRecord }) => {
      // executor logic here
    },
  });
```

after:

```typescript
createExecutor({
  name: "executor-name",
  description: "Executor description",
  trigger: recordCreatedTrigger({
    type: user,
    condition: ({ newRecord }) => newRecord.age < 18,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      // executor logic here
    },
  },
});
```

Additionally, the function set in `body` can now be easily retrieved with typing. This should be useful when you want to execute the function in unit tests, for example.

```typescript
const executor = createExecutor({
  // ...other properties
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      // executor logic here
    },
  },
});

const body = executor.operation.body;
```

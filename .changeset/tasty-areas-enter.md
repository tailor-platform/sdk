---
"@tailor-platform/tailor-sdk": patch
---

Supported disabling executors

Made it possible to disable executors by setting the disabled option to true.

```typescript
const disabled = createExecutor("test-executor", {
  disabled: true,
})
  .on(incomingWebhookTrigger())
  .executeFunction({
    fn: () => {
      // Do something
    },
  });
```

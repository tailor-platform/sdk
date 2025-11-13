---
"@tailor-platform/tailor-sdk": patch
---

Also accept simple objects instead of `t.object()` in resolver output

Previously, you had to always use `t.object()`, but now you can specify output in the same format as input.

```typescript
// OK
createResolver({
  output: t.object({
    name: t.string(),
    age: t.int(),
  }),
});

// Also OK (same meaning as above)
createResolver({
  output: {
    name: t.string(),
    age: t.int(),
  },
});
```

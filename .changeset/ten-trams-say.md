---
"@tailor-platform/sdk": patch
---

Allow setting self relationship with keyOnly

Fixed an issue where apply failed with the following configuration:

```typescript
db.type("Node", {
  childId: db.uuid().relation({
    type: "keyOnly",
    toward: { type: "self" },
  }),
});
```

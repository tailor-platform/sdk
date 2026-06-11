---
"@tailor-platform/sdk": patch
---

Fix `db.fields.timestamps()` so `updatedAt` is updated on every record update. Since update hooks receive the stored value merged with the input, the previous `value ?? new Date()` fallback froze `updatedAt` at its first value. `createdAt` still respects a user-specified value on create.

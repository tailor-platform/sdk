---
"@tailor-platform/sdk": minor
---

A resolver's `permission` can now compare an input with the caller through an `{ input: "<field>" }` operand, e.g. `[{ input: "employeeId" }, "=", { user: "id" }]`, so a caller cannot act on another user's data by sending their ID. The operand names a top-level non-array `t.string()`, `t.uuid()`, or `t.enum()` input field, is compared with `=`, can only be used in a `permit: true` policy, and never matches when the input is omitted. `defaultPermission` cannot use it.

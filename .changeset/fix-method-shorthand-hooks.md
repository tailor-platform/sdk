---
"@tailor-platform/sdk": patch
---

Fix TailorDB hooks and validators defined with method shorthand syntax (e.g. `hooks: { create() { ... } }`) failing at deploy time when the body contained an arrow function or the method was `async`

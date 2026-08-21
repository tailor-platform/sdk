---
"@tailor-platform/sdk": patch
---

Fix TailorDB hooks and validators sharing one function reference (e.g. `hooks: { create: fn, update: fn }`) being deployed with the argument shape of only the last role, which made the other role read undefined values at runtime.

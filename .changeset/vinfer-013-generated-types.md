---
"@tailor-platform/sdk": patch
---

Upgraded the internal `vinfer` tool used to generate this package's TypeScript types from Valibot schemas, fixing several cases where a recursive or nested type collapsed to `any` in the generated output. Types like `TailorField` and resolver `input`/`output` field definitions are now fully typed instead of losing type-checking partway through, with no change to runtime behavior.

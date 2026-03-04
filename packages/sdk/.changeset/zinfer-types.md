---
"@tailor-platform/sdk": minor
---

Generate TypeScript types from Zod schemas using zinfer, eliminating z.infer/z.input/z.output usage. Introduces src/types/ as a shared type layer between configure and parser modules, fully decoupling configure from parser imports.

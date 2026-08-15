---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Switched the SDK's internal schema library from Zod to Valibot, and its CLI framework from `politty` to `@politty/valibot`. Neither library is exposed through any public export, and `tailor.config.ts` files, field definitions, and CLI usage are unaffected.

The only user-visible difference is validation error wording: an invalid `tailor.config.ts` or an invalid resolver/executor/workflow module now reports errors phrased by Valibot rather than Zod (e.g. `Invalid type: Expected string but received 123` instead of Zod's phrasing). The information conveyed — which field, what was expected, what was received — is the same.

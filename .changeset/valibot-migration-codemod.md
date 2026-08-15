---
"@tailor-platform/sdk-codemod": patch
---

Switched this package's internal CLI argument parsing from Zod/`politty` to Valibot/`@politty/valibot`. This is invisible to users: it affects only how `tailor upgrade`'s own command-line flags are parsed, not the codemod transforms it applies to user code.

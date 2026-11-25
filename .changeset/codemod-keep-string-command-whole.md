---
"@tailor-platform/sdk-codemod": patch
---

`tailor upgrade` now reports a deprecated command written in a TypeScript/JavaScript string for manual review even when the string contains an escape sequence or a `${...}` substitution, such as `` `tailor deploy ${file} --old-flag` ``. Previously such a command was split at the escape or substitution and could be missed.

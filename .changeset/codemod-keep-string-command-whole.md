---
"@tailor-platform/sdk-codemod": patch
---

Keep a command written as a TypeScript/JavaScript string in one piece when it contains an escape sequence or a `${...}` substitution, so codemod review patterns that read a whole command can match it.

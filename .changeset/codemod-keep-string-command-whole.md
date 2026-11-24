---
"@tailor-platform/sdk-codemod": patch
---

Keep a command written as a TypeScript/JavaScript string in one piece when it contains an escape sequence or a `${...}` substitution, and report `tailor function run` calls whose `--name` or `-n` flag is wrapped in quotes (`"--name"`, `'-n'`), so codemod review patterns that read a whole command can match them.

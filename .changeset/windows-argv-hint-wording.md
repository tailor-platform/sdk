---
"@tailor-platform/sdk": patch
---

On Windows, follow-up hints whose arguments contain `%`, `$`, or `!` (for example a profile named `dev$1`) no longer present an `argv [...]` array as a command to run. They now tell you to run `tailor` with each item of the listed JSON array as one argument.

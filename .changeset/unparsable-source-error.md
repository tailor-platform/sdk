---
"@tailor-platform/sdk": patch
---

When a TailorDB type, resolver, executor, workflow, HTTP adapter, or `function run` file cannot be parsed, report a `SYNTAX_INVALID` error naming the file, the line, and the syntax error, instead of `[object Object]`. A config, or a file it imports, that cannot be parsed now reports the same error with its file and line in the message, instead of `UNEXPECTED_ERROR`, and its GitHub Actions annotation is titled `SYNTAX_INVALID` instead of `SyntaxError`.

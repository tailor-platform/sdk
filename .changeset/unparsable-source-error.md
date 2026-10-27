---
"@tailor-platform/sdk": patch
---

When a `.ts` or `.mts` file the CLI loads cannot be parsed, report a `SYNTAX_INVALID` error naming the file, the line, and the syntax error. For a TailorDB type, resolver, executor, workflow, HTTP adapter, or `function run` file, or a file one of them imports, this replaces `[object Object]`. For a config, or a file it imports, it replaces `UNEXPECTED_ERROR`, and the GitHub Actions annotation is titled `SYNTAX_INVALID` instead of `SyntaxError`.

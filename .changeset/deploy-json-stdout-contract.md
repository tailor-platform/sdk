---
"@tailor-platform/sdk": patch
---

Document that `tailor deploy --json` writes exactly one JSON object to stdout and sends progress and diagnostics to stderr, and that deploy plugins report through `ctx.logger` and `ctx.exec` to keep that output parseable.

---
"@tailor-platform/sdk": minor
---

`tailor-sdk function logs <executionId>` now displays error details for failed executions. When `getFunctionExecution` returns a stack trace, the deployed script is downloaded automatically and frames are mapped back to the original source files via the inline sourcemap (with clickable file links and code snippets, matching the existing `function test-run` output). When the script cannot be downloaded or the stack trace is missing, the command falls back to a plain-text `Name: message` display.

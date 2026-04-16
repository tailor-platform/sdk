---
"@tailor-platform/sdk": minor
---

`tailor-sdk function logs <executionId>` now displays error details for failed executions. When `getFunctionExecution` returns a stack trace, the deployed script is downloaded automatically and frames are mapped back to the original source files via the inline sourcemap (with clickable file links and code snippets, matching the existing `function test-run` output). When the script cannot be downloaded, the stack trace is missing, or the function has been redeployed after the execution (detected by comparing the registry entry's `updatedAt` against the execution start time), the command falls back to a plain-text `Name: message` display with the raw stack trace to avoid showing misleading source locations.

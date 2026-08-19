---
"@tailor-platform/sdk": patch
---

Fix the missing deprecation warning for `tailor function test-run` when a global option precedes the subcommand, such as `tailor function --json test-run`.

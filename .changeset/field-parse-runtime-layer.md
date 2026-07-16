---
"@tailor-platform/sdk": patch
---

Fix `tailor function test-run` crashing with `TypeError: Cannot convert undefined or null to object` when `--arg` is a non-object JSON value such as `null`. The argument is now forwarded to the server, which reports the validation error. Local input validation also runs the same logic as deployed resolvers.

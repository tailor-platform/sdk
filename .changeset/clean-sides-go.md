---
"@tailor-platform/sdk": patch
---

When the Platform or the network reports a request as unavailable after the Platform may already have accepted it, the CLI no longer resends a request that would apply it again. Scripts run by `tailor query` or `tailor function run`, `tailor executor trigger`, `tailor workflow resume`, and the tokens created by `tailor user pat create` and `tailor user pat update` no longer run or get created twice; these commands, and most other writes outside `tailor deploy`, now report the error instead of retrying. Requests that never reached the Platform are still retried.

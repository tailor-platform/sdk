---
"@tailor-platform/sdk": minor
---

Show why each function execution failed in `tailor function logs`. Every execution now includes `errorKind` (`USER_RUNTIME`, `USER_NON_RUNTIME`, `PLATFORM`, `NONE`, or `UNSPECIFIED`), `errorName`, and `errorMessage`, so the list tells you whether a failure came from your code or the Platform without opening each execution. The list table shows `errorKind` and `errorName`; `--json` and the execution details also include `errorMessage`.

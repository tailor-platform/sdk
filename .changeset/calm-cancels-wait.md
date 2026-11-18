---
"@tailor-platform/sdk": patch
---

Recognize the `CANCELING` workflow execution status, which an execution holds between a cancel request and `CANCELED`. `tailor workflow executions --status CANCELING` filters by it, and commands that wait for an execution keep waiting through it.

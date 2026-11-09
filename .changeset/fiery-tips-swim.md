---
"@tailor-platform/sdk": patch
---

Fix the "Event Payloads" section of the executor guide: it names the exported `*Args` trigger args types instead of interfaces the SDK does not export, no longer lists a `scheduledTime` field that `ScheduleArgs` does not have, and its resolver-executed examples narrow on `success` so they type-check.

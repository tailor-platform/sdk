---
"@tailor-platform/sdk": patch
---

Fix `resolverExecutedTrigger` typing date fields as `Date`. The executor receives the event as JSON, so a `t.date({ as: "date" })` field arrives as its `YYYY-MM-DD` string and `t.datetime()` as an ISO string; `result` now reports both as `string` instead of allowing `Date` methods that threw at runtime.

---
"@tailor-platform/sdk": patch
---

Fix `resolverExecutedTrigger` typing a `t.date({ as: "date" })` result as `Date`. The executor receives the event as JSON, so such a field arrives as its `YYYY-MM-DD` string and `result` now reports that.

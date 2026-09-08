---
"@tailor-platform/sdk": patch
---

Clarify the errors thrown when a resolver returns a value that cannot be serialized for `t.date({ as: "date" })`: the type-mismatch error now describes the actual value received, and the invalid-date error now states the reason (e.g. an out-of-range year) inline instead of only in the error's `cause`.

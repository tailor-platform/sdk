---
"@tailor-platform/sdk": major
---

`executeScript` now takes its `arg` as a JSON-serializable value instead of a pre-serialized JSON string. Pass the value directly (e.g. `arg: { a: 1 }`) instead of `arg: JSON.stringify({ a: 1 })`.

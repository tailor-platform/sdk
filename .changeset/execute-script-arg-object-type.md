---
"@tailor-platform/sdk": major
---

`executeScript`'s `arg` option no longer accepts a bare string. Passing a pre-stringified value (`arg: JSON.stringify(x)`) — which previously type-checked and silently double-encoded at runtime — is now a compile error. Objects, arrays, numbers, booleans, and `null` are still accepted at the top level (including object fields with `undefined` values), so this doesn't affect existing callers passing an object, array, or primitive argument — only the specific `JSON.stringify(...)` mistake is now caught.

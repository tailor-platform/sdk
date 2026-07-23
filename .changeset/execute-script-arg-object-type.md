---
"@tailor-platform/sdk": major
---

`executeScript`'s `arg` option is now typed as a JSON object (`Record<string, Jsonifiable>`) instead of any JSON-serializable value. Passing a pre-stringified value (`arg: JSON.stringify(x)`) — which previously type-checked and silently double-encoded at runtime — is now a compile error. `tailor function test-run --arg` now rejects non-object JSON with a clear error instead of forwarding it to the platform.

---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

`executeScript` now takes its `arg` as a JSON-serializable value instead of a pre-serialized JSON string. Pass the value directly (e.g. `arg: { a: 1 }`) instead of `arg: JSON.stringify({ a: 1 })`.

Add the `v2/execute-script-arg` codemod, which unwraps `JSON.stringify(...)` passed as the `executeScript` `arg` option. Indirect forms (a stringified value held in a variable, etc.) cannot be rewritten automatically and are surfaced as an LLM-assisted review task with a migration prompt.

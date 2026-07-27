---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
---

Add a lint rule (`no-execute-script-arg-stringify`) that flags passing a `JSON.stringify(...)` result as `executeScript`'s `arg` option — `executeScript` serializes `arg` internally, so a pre-stringified value silently double-encodes at runtime. Enabled in newly scaffolded projects.

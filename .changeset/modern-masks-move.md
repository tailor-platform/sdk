---
"@tailor-platform/sdk": patch
---

`errorToJson` from `@tailor-platform/sdk/cli` now returns the envelope that `serializeError` writes, so its result can be embedded in JSON output: string values come without colors and with registered secrets redacted, and a context that cannot be written as JSON is left out along with the stack

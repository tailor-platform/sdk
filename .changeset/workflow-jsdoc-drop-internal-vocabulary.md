---
"@tailor-platform/sdk": patch
---

Drop internal RPC vocabulary from the JSDoc on the `tailor.workflow` runtime API. The module doc and `execJobFunction`'s own doc described the wire-format history behind the current names, which reached editor tooltips without telling users anything they could act on. The behaviour the text was explaining is kept: `execJobFunction` blocks until the job finishes and returns its result, while `startWorkflow` returns only an execution ID.

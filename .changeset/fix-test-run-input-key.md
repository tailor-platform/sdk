---
"@tailor-platform/sdk": patch
---

`function test-run` resolver arg no longer requires the `input` wrapper key — pass input fields directly (e.g. `-a '{"a":1}'`). The old `{"input":{...}}` format still works but is deprecated and will be removed in v2.

---
"@tailor-platform/sdk": patch
---

`function test-run` resolver arg no longer requires the `input` wrapper key — pass input fields directly (e.g. `-a '{"a":1}'`). The old `{"input":{...}}` format is detected via schema validation and emits a deprecation warning. When no input schema is defined, `--arg` is ignored with a warning.

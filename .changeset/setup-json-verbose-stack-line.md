---
"@tailor-platform/sdk-plugin-setup": patch
---

`tailor setup` commands run with `--json --verbose` now keep the JSON error line last on stderr, without a human-readable stack trace after it. The stack trace is still in the JSON error's `stack` field.

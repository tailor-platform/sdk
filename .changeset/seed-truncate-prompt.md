---
"@tailor-platform/sdk-plugin-seed": patch
---

`tailor seed apply --truncate` now asks for confirmation the same way as `tailor tailordb truncate`. Under `--json`, in CI, or without an interactive terminal, it no longer prints the question to stdout or reports a cancelled result; it fails and asks you to pass `--yes`.

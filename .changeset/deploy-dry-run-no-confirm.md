---
"@tailor-platform/sdk": patch
---

`tailor deploy --dry-run` no longer asks to confirm resource deletions, owner conflicts, unmanaged resources, or missing dependent applications, so it reaches the plan without `--yes`, including under `--json` or without a terminal. The warnings that list those resources are still shown.

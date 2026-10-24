---
"@tailor-platform/sdk": patch
---

`tailor deploy --dry-run` no longer asks to confirm resource deletions, owner conflicts, unmanaged resources, or missing dependent applications, so it reaches the plan without `--yes`, including under `--json` or without a terminal. The warnings that list those resources are still shown, and the warning that lists the TailorDB migration checkpoints the deploy would reset is now shown too.

With `--dry-run --json`, `warnings` now also has a `type: "missingDependentApp"` entry for each resource whose recorded dependent application is missing from the deploy. Before, this was only printed to stderr.

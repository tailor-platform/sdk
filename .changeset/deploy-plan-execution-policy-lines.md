---
"@tailor-platform/sdk": patch
---

Fix the `tailor deploy` plan leaving out workflow execution policies: their changes are now listed in the Workflow section, and unmanaged or conflicting execution policies and applications now appear in the plan's warnings and owner conflicts, including `--json` output.

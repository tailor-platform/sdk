---
"@tailor-platform/sdk": patch
---

Confirm important resource deletion

Added a confirmation prompt when attempting to delete resources that would result in data loss (tailordb and staticwebsite).
This can be skipped with the `--yes` flag.

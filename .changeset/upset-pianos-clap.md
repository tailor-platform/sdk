---
"@tailor-platform/sdk-plugin-setup": patch
---

The `tailor setup ci env --check` errors for a repository it cannot identify or whose secrets and variables GitHub denies listing, and the error for edits that cannot be merged into a regenerated workflow file now end with the quoted `gh` or YAML message, after `Reason:`, so a message that ends with a period no longer gets a second one.

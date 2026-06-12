---
"@tailor-platform/sdk": minor
---

Validate planned resources against platform constraints before applying changes in `deploy`. Constraint violations (such as invalid resource names or out-of-range values) are now reported together before any change is applied, instead of failing one by one during the apply step. The same check runs with `--dry-run`, and `--no-validate` skips it.

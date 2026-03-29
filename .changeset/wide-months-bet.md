---
"@tailor-platform/sdk": minor
---

Improve apply planning by adding stable no-op detection and plan summaries.

- Mark resources as `unchanged` when requested configuration already matches remote state, and keep update/create/delete behavior unchanged for drift, ownership mismatch, or missing resources.
- Add a consolidated plan summary line (create/update/delete/replace/unchanged) to `apply` output and include unchanged counts in plan reporting.

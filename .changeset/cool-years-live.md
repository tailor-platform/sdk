---
"@tailor-platform/sdk": patch
---

Fix getGeneratedTable and getExtendedTable to honor default test-file exclusions, explicit ignores, and ordered negations when resolving table namespaces

Preserve CLI fallback warnings when table helpers have already warned about the same file patterns.

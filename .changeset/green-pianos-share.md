---
"@tailor-platform/sdk": patch
---

Reject duplicate TailorDB type names across application namespaces, including deployed external TailorDB namespaces checked at deploy time. Projects that currently reuse a type name across namespaces will fail validation on the next `generate` or `deploy`; rename the duplicated types before upgrading.

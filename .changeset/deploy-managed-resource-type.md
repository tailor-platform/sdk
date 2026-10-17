---
"@tailor-platform/sdk": patch
---

Guard the `resourceType` values in `tailor deploy --dry-run --json` output against accidental changes. No observable behavior change.

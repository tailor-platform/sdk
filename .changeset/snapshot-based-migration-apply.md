---
"@tailor-platform/sdk": minor
---

feat: snapshot-based migration apply

- Extend snapshot schema (v2) to include relationships, permissions, files, hooks, and validation rules
- Generate proto manifests directly from snapshots for migration-based deployments
- Add support for index, file, relationship, and permission diff kinds
- Separate migration e2e test templates from example app migrations

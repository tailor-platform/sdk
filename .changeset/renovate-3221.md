---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

fix(deps): update dependency lines-db to v0.19.3

Seed loading now reads a JSONL row surrounded by a non-breaking space or a second byte order mark the same way `lines-db validate` does, instead of failing with `Invalid JSON`.

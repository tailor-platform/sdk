---
"@tailor-platform/sdk-plugin-seed": patch
---

Add e2e coverage for `tailor seed apply` against a real deployed workspace: basic TailorDB seeding, `--upsert` insert/update behavior, `--upsert` for the Built-In IdP `_User` entity (create/update/skip), and `--truncate` before seeding.

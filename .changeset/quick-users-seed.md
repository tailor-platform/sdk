---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

Speed up seeding and truncating Built-in IdP `_User` records. `tailor seed apply` now creates, upserts, and deletes up to 16 users at once instead of one at a time, so 35 users take a few seconds rather than about 2.5 minutes. If the same `name` appears on more than one `_User` row, `tailor seed apply` now stops before applying anything and lists the repeated rows (`Row 3 (alice): duplicate of row 1`), because concurrent requests for one name can create duplicate users in the IdP. Previously the later row was applied after the earlier one, so with `--upsert` it overwrote the earlier row.

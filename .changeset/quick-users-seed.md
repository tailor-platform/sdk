---
"@tailor-platform/sdk": patch
---

Speed up seeding and truncating Built-in IdP `_User` records. `tailor seed apply` now creates, upserts, and deletes up to 16 users at once instead of one at a time, so 35 users take a few seconds rather than about 2.5 minutes. If the same `name` appears on more than one row in a chunk of `_User` data, every row after the first is reported as `duplicate of row N` and skipped, instead of reaching the IdP, where concurrent requests for one name can create duplicate users.

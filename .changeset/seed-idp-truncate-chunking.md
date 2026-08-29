---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-plugin-seed": patch
---

Fix `tailor seed apply --truncate` failing to delete IdP `_User` records. Deletion now runs in chunks of 25 users per request so large user counts no longer hit `deadline_exceeded`, and a user that is listed but already gone by the time it is deleted counts as deleted instead of failing every run.

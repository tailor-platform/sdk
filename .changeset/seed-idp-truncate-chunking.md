---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": patch
---

Fix `tailor seed apply --truncate` failing to delete IdP `_User` records. Deletion now runs in chunks of 25 users per request so large user counts no longer hit `deadline_exceeded`, and a user that is listed but already gone by the time it is deleted counts as deleted instead of failing every run.

`SeedIdpUserContext` from `@tailor-platform/sdk/cli` gains a required `listScriptCode` field carrying the server-side script that lists the `_User` records to delete; `truncateScriptCode` now deletes the chunk of users passed as input, and keeps listing and deleting every user when called without input.

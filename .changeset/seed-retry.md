---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-seed": minor
---

Add `tailor seed retry`, which runs the TailorDB seed chunk that failed in the last `tailor seed apply` again and then the chunks after it. A failed chunk now stops `tailor seed apply` and leaves a record of where it stopped in the workspace, until the next `tailor seed apply` for that namespace or a successful retry removes it. `tailor seed retry` exits with an error when no failed chunk is recorded, when the seed data no longer matches the failed run, or when an earlier run is still running. A failure while seeding the IdP `_User` is not recorded.

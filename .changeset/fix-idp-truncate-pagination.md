---
"@tailor-platform/sdk": patch
---

Fix `seed --truncate` deleting only the first page of Built-In IdP `_User` records. The generated truncation script used incorrect pagination keys, so projects with more than one page of users were left with the remaining pages while the command still reported success. All pages are now deleted.

---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration validate` now fails, with the error code `tailor deploy` reports, when a migration an earlier deploy left in progress would stop the next deploy, and accepts `--migration-skip-steps` to check the steps to skip the way `tailor deploy` does

---
"@tailor-platform/sdk": patch
---

fix: add bidirectional foreign key between IDP user and userProfile type in seed schema

When auth.userProfile is configured, the seed plugin now generates a foreign key from the userProfile type back to `_User`, ensuring seed data validation catches mismatches in both directions. Also bumps @toiroakr/lines-db to 0.9.1 which supports circular FK validation.

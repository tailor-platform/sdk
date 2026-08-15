---
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk": patch
---

Fix `tailor seed apply` timing out with `deadline_exceeded` when seeding 100+ IdP `_User` rows. `_User` rows are now sent in chunks of 25, and when a chunk fails the confirmed created/updated counts are reported so re-running with `--upsert` is an informed choice. Script execution error output no longer dumps the script source and its argument (which contained seeded user credentials).

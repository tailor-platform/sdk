---
"@tailor-platform/sdk": minor
---

Add `tailor-sdk tailordb migration sync <number>`. The new subcommand reconstructs the TailorDB schema snapshot at the given migration number (e.g. `0` for the baseline) and brings the remote in line with it without requiring a `git checkout`. Useful for recovering from drift introduced by an unintended `deploy --no-schema-check`. Before touching the remote, the command verifies that replaying the full migration history reproduces the current local type definitions, and shows the current vs. target migration with warnings about `migrate.ts` scripts that will re-execute or be skipped on the next deploy. After syncing, run `tailor-sdk deploy` to catch up the remaining migrations from the working tree.

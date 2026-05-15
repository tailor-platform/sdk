---
"@tailor-platform/sdk": minor
---

Add `tailor-sdk tailordb migration sync <number>`. The new subcommand reconstructs the TailorDB schema snapshot at the given migration number (e.g. `0` for the baseline) and brings the remote in line with it without requiring a `git checkout`. Useful for recovering from drift introduced by an unintended `deploy --no-schema-check`. After syncing, run `tailor-sdk deploy` to catch up the remaining migrations from the working tree.

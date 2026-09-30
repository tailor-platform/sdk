---
"@tailor-platform/sdk-plugin-setup": minor
---

Add `tailor setup update`, which regenerates every workflow and composite action recorded in `.github/tailor.lock` with the flags each was generated with, so picking up a new workflow template no longer means re-running each `tailor setup ci` subcommand by hand. A target that cannot be regenerated (for example a hand-edited managed part) is listed at the end without stopping the others, and `--force` resets hand edits to managed parts of every target. `tailor setup check` now points at this command. Coordinators generated before this release do not record their `--action` grouping; re-run `tailor setup ci coordinate` once with the same flags so `update` can regenerate them.

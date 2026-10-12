---
"@tailor-platform/sdk-plugin-setup": minor
---

Seed the workspace from the generated deploy workflows: `tailor setup ci branch`, `tag`, and `preview` take `--seed` and `--seed-dataset <name>` (repeatable, implies `--seed`), which add a `tailor-seed` step after the deploy step. It validates the seed data with the selected datasets and applies it with `tailor seed apply --upsert` for branch and tag targets, or `--truncate --yes` for preview workspaces; the plan job's seed validation checks the datasets too. Setup stops when the config has no `seedPlugin`, `seedPlugin` has no `machineUserName` or `distPath`, or a dataset is unknown, and seeding is available for targets that deploy one app. `tailor setup update` keeps the flags, and `tailor setup check` reports a seeding target whose `seedPlugin` settings no longer allow it.

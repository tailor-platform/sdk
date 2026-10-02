---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

`tailor setup ci branch`, `tailor setup ci tag`, and `tailor setup ci preview` accept `--dir` more than once. The generated workflow deploys every app to the same workspace in one multi-config run from the repository root, runs the generate check for each app directory (plus seed validation and the migration drift check on branch and tag workflows), and runs its jobs on changes under any of them. `--name` is required when `--dir` is repeated, and the root `package.json` must declare `@tailor-platform/sdk`. With `--erd-preview`, each TailorDB namespace is previewed from the app that owns it.

`tailor setup ci branch` and `tailor setup ci preview` also accept `--paths` (repeatable) to trigger the workflow on changes outside the app directories, such as a frontend or shared packages. A pattern supports `*`, `**`, and a leading `!` to exclude paths; other glob characters are rejected.

Branch and preview workflows with an app directory other than the repository root no longer filter their `on:` triggers by `paths`. Branch workflows start on every pull request and push, preview workflows on every pull request, and a new `tailor-changes` job skips the plan, deploy, and preview jobs when nothing under the app directories (or `--paths`) changed. Skipped jobs report success, so these checks can be required in branch protection. If the `tailor-changes` job itself fails, those jobs fail instead of being skipped, so a required check cannot pass without them. `setup` remains a beta command, so this ships as an immediate change rather than going through a deprecation cycle.

Branch workflows generated with `--erd-preview` now install the project dependencies before building the ERD preview, which the setup step does not do.

The workflow template version is bumped, so `tailor setup check` reports every generated target as outdated; run `tailor setup update` to regenerate them. Branch and preview workflows whose `--dir` is not the repository root switch to the `tailor-changes` job described above, and branch workflows generated with `--erd-preview` get the new ERD matrix and install step. Every generated workflow and composite action also moves its `tailor-platform/actions` pin to v2.4.0; other workflows change in nothing else. `tailor setup update` keeps every app directory and `--paths` pattern of a multi-directory target.

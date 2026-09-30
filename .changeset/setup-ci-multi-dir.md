---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

`tailor setup ci branch`, `tailor setup ci tag`, and `tailor setup ci preview` accept `--dir` more than once. The generated workflow deploys every app to the same workspace in one multi-config run from the repository root, runs the generate check, seed validation, and migration drift check for each app directory, and triggers on changes under any of them. `--name` is required when `--dir` is repeated, and the root `package.json` must declare `@tailor-platform/sdk`. With `--erd-preview`, each TailorDB namespace is previewed from the app that owns it.

`tailor setup ci branch` and `tailor setup ci preview` also accept `--paths` (repeatable) to trigger the workflow on changes outside the app directories, such as a frontend or shared packages.

The workflow template version is bumped, so `tailor setup check` reports every generated target as outdated. Re-run the setup subcommand to pick it up: only branch workflows generated with `--erd-preview` change, and other single-`--dir` workflows regenerate identically. If you group apps with a comma in `tailor setup ci coordinate --action`, re-run `tailor setup ci action --force` for each grouped app before re-running `setup ci coordinate`.

---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Generated deploy jobs now expose the deployed workspace as job outputs, so a job of your own can use `needs:` to run tests or deploy extra assets against it:

- `tailor setup ci preview`: the `tailor-preview-deploy` job exposes `workspace-id`, `workspace-name`, and `app-url` of the per-PR workspace.
- `tailor setup ci branch` and `tailor setup ci tag`: the `tailor-deploy` job exposes `workspace-id` and `app-url`.

`tailor setup check` reports the template as outdated; re-run the setup subcommand to pick it up. If you group apps with a comma in `tailor setup ci coordinate --action`, re-run `tailor setup ci action --force` for each grouped app before re-running `setup ci coordinate`.

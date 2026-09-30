---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Generated deploy jobs now expose the deployed workspace as job outputs, so a job of your own can use `needs:` to run tests or deploy extra assets against it:

- `tailor setup ci preview`: the `tailor-preview-deploy` job exposes `workspace-id`, `workspace-name`, and `app-url` of the per-PR workspace.
- `tailor setup ci branch` and `tailor setup ci tag`: the `tailor-deploy` job exposes `workspace-id` and `app-url`.

`tailor setup check` reports the template as outdated; run `tailor setup update` to regenerate every target.

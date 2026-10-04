---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

You can add `environment:` to a managed job that `tailor setup ci` generates without one (`tailor-tag-guard`, and the `tailor-erd-preview*` jobs from `--erd-preview`), so a step you added there can read that GitHub Environment's secrets, such as a token for installing dependencies from a private registry. `tailor setup check` no longer reports it as a hand edit, and re-running `tailor setup ci` keeps it. The `environment:` of `tailor-plan`, `tailor-deploy`, and the preview jobs still comes from `--environment`.

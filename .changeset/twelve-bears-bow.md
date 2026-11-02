---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Add `tailor setup ci autofix`, which generates `.github/workflows/tailor-autofix.yml`: on every pull request it runs `tailor generate` and commits what that changes to the pull request branch, so a pull request whose generated files are out of date no longer needs a local `tailor generate` and a new commit. `--provider` chooses what makes the commit: `github-token` (the default, with the workflow token; GitHub then waits for someone with write access to approve the workflows of the fix commit), `github-app` (a GitHub App token, so the checks run right away), `autofix-ci`, or `securefix`. Fork and Dependabot pull requests are skipped, except with `autofix-ci`. `tailor setup update`, `check`, and `delete` handle the new workflow, and `tailor setup ci env` lists and checks the repository secret and variable that `github-app` and `securefix` need. With `--json`, `tailor setup ci env` then reports them as an entry whose `environment` is `null`.

This release also raises the workflow template version, so `tailor setup check` reports a template-version finding for existing workflows until you run `tailor setup update`. With `TAILOR_PLATFORM_FAIL_ON_DRIFT` set to `true`, the drift check fails until then.

---
"@tailor-platform/sdk-plugin-setup": minor
---

`tailor setup ci autofix --provider github-pat` commits the files `tailor generate` changes with a personal access token from the `TAILOR_AUTOFIX_TOKEN` secret. Like `github-app`, the checks on the fix commit run without approval, without creating a GitHub App. `tailor setup ci env` lists the secret.

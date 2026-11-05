---
"@tailor-platform/sdk-plugin-setup": minor
---

`tailor setup ci autofix --provider github-pat` commits the files `tailor generate` changes with a personal access token from the `TAILOR_AUTOFIX_TOKEN` secret. Like `github-app`, the checks on the fix commit run without approval, without creating a GitHub App. The command warns that the commits depend on the token owner's account, and the workflow warns when the token is a classic one. `tailor setup ci env` lists the secret.

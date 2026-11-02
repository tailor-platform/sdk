---
"@tailor-platform/sdk-plugin-setup": patch
---

`tailor setup check` now reports a `.github/tailor-sdk.lock` left by an older setup (rule key `legacy-lock`), together with the workflows and actions it records that `.github/tailor.lock` does not track. Those workflows kept running unnoticed, for example a preview workflow that creates a workspace for every pull request. The finding prints the `git rm` command that removes them, and like any drift finding it makes `check` exit non-zero.

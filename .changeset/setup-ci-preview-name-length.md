---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

`tailor setup ci preview` now rejects a name longer than 50 characters. Each pull request's preview workspace is named `<name>-pr-<number>`, which must fit in 63 characters, so a longer name made preview deploys fail once pull request numbers grew (from the first pull request for names of 59 characters or more). A preview workflow already recorded in `.github/tailor.lock` under a longer name still regenerates, for example with `tailor setup update`, with a warning naming the first pull request number whose preview deploy fails.

---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

`tailor setup ci preview` now rejects a name longer than 50 characters instead of generating a workflow whose pull request deploys fail later: each pull request's workspace is named `<name>-pr-<number>`, which must fit in 63 characters. A preview workflow already generated under a longer name still regenerates with `tailor setup update`, with a warning naming the first pull request number whose preview deploy fails.

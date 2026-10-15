---
"@tailor-platform/create-sdk": patch
---

Accept the project name as `--name` again in `npm create @tailor-platform/sdk -- --name my-app`. After the `@politty/zod` 0.4 update the option was ignored with an `Unknown option` warning and the command asked for the name interactively, which stalled non-interactive scripts. Passing the name positionally, as in `my-app`, is unchanged.

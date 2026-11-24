---
"@tailor-platform/sdk": patch
---

In a config without an Auth service, `tailor deploy` now stops with `WORKFLOW_START_INVOKER_AUTH_REQUIRED` at a workflow `.start()` whose `invoker` is a string literal, instead of deploying a start that runs the workflow without the machine user. Name the Auth service instead: `{ invoker: { namespace: "<auth>", machineUserName: "<machine user>" } }`. A string invoker that is not a literal in the call (a variable, a conditional, or a function call, for example) is not caught, and the workflow still runs without the machine user.

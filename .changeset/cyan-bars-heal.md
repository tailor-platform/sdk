---
"@tailor-platform/sdk": patch
---

In a config without an Auth service, `tailor deploy` now stops with `WORKFLOW_START_INVOKER_AUTH_REQUIRED` at a workflow `.start()` whose `invoker` is a plain string, instead of deploying a start that runs the workflow without the machine user. It also stops with `WORKFLOW_START_INVOKER_UNRESOLVED` when the options or the invoker are held in a variable, because the build cannot tell whether they name an Auth service. Name the Auth service in the `.start()` call: `{ invoker: { namespace: "<auth>", machineUserName: "<machine user>" } }`.

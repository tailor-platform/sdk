---
"@tailor-platform/sdk": patch
---

In a config without an Auth service, `tailor deploy` now stops with `WORKFLOW_START_INVOKER_AUTH_REQUIRED` at a workflow `.start()` whose `invoker` is a plain string, instead of deploying a start that runs the workflow without the machine user. It also stops with `WORKFLOW_START_INVOKER_UNRESOLVED` when the options or the invoker are not written as a literal in the call (a variable, a spread, or a conditional, for example), because the build cannot tell whether they name an Auth service; `undefined` as the options or the invoker is still accepted. Name the Auth service with an object literal in the `.start()` call: `{ invoker: { namespace: "<auth>", machineUserName: "<machine user>" } }`.

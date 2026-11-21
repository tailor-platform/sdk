---
"@tailor-platform/sdk": minor
---

Resolvers, executor operations, and `workflow.start()` accept `invoker: { namespace, machineUserName }` to name the Auth service of the machine user. `tailor deploy` checks the invoker of each resolver and executor operation against the machine users of that Auth service; an object invoker was not checked before. It stops with `INVOKER_MACHINE_USER_NOT_FOUND` when the machine user does not exist, and with `INVOKER_AUTH_NOT_FOUND` when the Auth service does not exist, including for a string invoker whose external Auth service does not exist, which got `INVOKER_MACHINE_USER_NOT_FOUND` before. Fix the name, or deploy the config that defines the Auth service first or in the same run.

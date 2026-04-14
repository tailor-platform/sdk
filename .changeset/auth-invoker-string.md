---
"@tailor-platform/sdk": minor
---

Accept plain string for `authInvoker` in resolvers, executors, and `workflow.trigger()` (e.g. `authInvoker: "kiosk"`). Machine user names are type-narrowed via the generated `tailor.d.ts` (`MachineUserNameRegistry` interface). `auth.invoker(...)` is now deprecated in favor of the string form, which avoids pulling config-layer (Node-only) dependencies into runtime bundles.

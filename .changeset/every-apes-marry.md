---
"@tailor-platform/sdk": minor
---

Add `authInvoker` option to `createResolver` for specifying a machine user to execute database operations and other platform actions. The `user` in the body function still reflects the original caller. Usage: `authInvoker: auth.invoker("machine-user-name")`

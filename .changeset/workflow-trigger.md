---
"@tailor-platform/sdk": minor
---

Add workflow trigger functionality

- Add `trigger` method to `Workflow` type that allows triggering workflows from resolvers and executors
- Support `authInvoker` option for authentication when triggering workflows

**Breaking Changes**

- AuthInvoker field names changed:
  - `authName` → `namespace`
  - `machineUser` → `machineUserName`
  - This affects both `auth.invoker()` return value and direct object usage in executor's `authInvoker` option

- Executor operation field renamed:
  - `invoker` → `authInvoker`

- SecretValue field names changed:
  - `VaultName` → `vaultName`
  - `SecretKey` → `secretKey`

---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`createGetDB` from `@tailor-platform/sdk/plugin/kysely-type/db` returns a `getDB` that type-checks only for the TailorDB namespaces you name, such as `createGetDB<"customer-db" | "order-db">()`. To keep part of your code to those namespaces, export that `getDB` from a module of your own and forbid importing the SDK's with `no-restricted-imports`. It restricts nothing at runtime.

The context of the generation hooks `onTailorDBReady`, `onResolverReady`, and `onExecutorReady` now has `auths`, every Auth service of the config keyed by its name. Their `auth` is deprecated and will be removed in v3. `tailor upgrade` to v3 runs the `v3/plugin-context-auths` codemod, which reports plugins that read `auth` for a manual change.

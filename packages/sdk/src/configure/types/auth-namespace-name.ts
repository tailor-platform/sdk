// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AuthNamespaceNameRegistry {}

/**
 * Auth namespace name, used by an AI gateway's `authNamespace`, an authAccessToken
 * trigger's `auth`, and the `namespace` of a machine user invoker
 * (`{ namespace, machineUserName }`).
 *
 * When `tailor.d.ts` is generated (via `tailor deploy`/`generate`), this is narrowed
 * to the Auth services of the config: the application's own one (from `defineAuth()`,
 * local or external) in a `defineConfig()` config, or every Auth service of a
 * `defineWorkspace()` config. When no auth namespace is registered yet, falls back to
 * `string` to avoid blocking editing before the first generate run.
 *
 * To name an auth namespace owned by a different application in the workspace, extend
 * the registry: `declare module "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry
 * { "other-app-auth": true } }`. An authAccessToken trigger's `auth` still has to name an
 * Auth service of the config; `deploy` rejects any other name.
 */
export type AuthNamespaceName = keyof AuthNamespaceNameRegistry extends never
  ? string
  : keyof AuthNamespaceNameRegistry & string;

// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AuthNamespaceNameRegistry {}

/**
 * Auth namespace name, used by an AI gateway's `authNamespace` and an authAccessToken
 * trigger's `auth`.
 *
 * When `tailor.d.ts` is generated (via `tailor deploy`/`generate`), this is narrowed
 * to the application's own auth namespace name (from `defineAuth()`, local or
 * external). When no auth namespace is registered yet, falls back to `string` to
 * avoid blocking editing before the first generate run.
 *
 * To let an `AIGatewayConfig` authenticate against an auth namespace owned by a
 * different application in the workspace, extend the registry: `declare module
 * "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry { "other-app-auth": true } }`.
 */
export type AuthNamespaceName = keyof AuthNamespaceNameRegistry extends never
  ? string
  : keyof AuthNamespaceNameRegistry & string;

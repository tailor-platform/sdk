// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface AuthNamespaceNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AuthNamespaceNameRegistry {}

/**
 * Auth namespace name.
 *
 * When `tailor.d.ts` is generated (via `tailor deploy`/`generate`), this offers the
 * application's own auth namespace name (from `defineAuth()`, local or external) as
 * an autocomplete suggestion — the common case, since an `AIGatewayConfig` usually
 * authenticates against its own app's auth. Any other `string` is still accepted,
 * since an AI Gateway may need to authenticate against an auth namespace owned by a
 * different application in the workspace.
 */
export type AuthNamespaceName = (keyof AuthNamespaceNameRegistry & string) | (string & {});

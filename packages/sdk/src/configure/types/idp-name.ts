// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface IdpNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IdpNameRegistry {}

/**
 * IdP namespace name.
 *
 * When `tailor.d.ts` is generated (via `tailor deploy`/`generate`), this is narrowed
 * to the union of defined IdP names. When no IdPs are registered yet, falls back to
 * `string` to avoid blocking editing before the first generate run.
 */
export type IdpName = keyof IdpNameRegistry extends never ? string : keyof IdpNameRegistry & string;

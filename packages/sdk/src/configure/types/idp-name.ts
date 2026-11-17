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
export type IdpName = IdpNameForRegistry<IdpNameRegistry>;

/**
 * IdP namespace name looked up in registry `R`.
 *
 * Generic over the registry so type-level tests can exercise the narrowing against a
 * local, disposable registry shape instead of `declare module`-augmenting the real
 * `IdpNameRegistry`, which is ambient and leaks into every file type-checked in the
 * same program.
 */
export type IdpNameForRegistry<R> = keyof R extends never ? string : keyof R & string;

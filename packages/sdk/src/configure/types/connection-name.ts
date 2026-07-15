// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface ConnectionNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConnectionNameRegistry {}

/**
 * Auth connection name.
 *
 * When `tailor.d.ts` is generated (via `tailor-sdk deploy`/`generate`), this is narrowed
 * to the union of connection names defined in `defineAuth()`'s `connections`. Falls back
 * to `string` before the first generate run.
 */
export type ConnectionName = keyof ConnectionNameRegistry extends never
  ? string
  : keyof ConnectionNameRegistry & string;

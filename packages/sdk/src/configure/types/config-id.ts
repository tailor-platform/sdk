// Interface for module augmentation.
// Written by the SDK into `tailor.d.ts` once `tailor.config.ts` has a
// resolved `id`; not intended for users to extend by hand.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConfigIdRegistry {}

/**
 * Whether `tailor.config.ts` currently has a resolved `id`, as recorded in
 * the generated `tailor.d.ts` (via `tailor-sdk deploy`/`generate`). Falls
 * back to `false` before the first generate run, so `defineConfig()`'s `id`
 * stays optional for a freshly scaffolded project.
 */
export type ConfigIdResolved = keyof ConfigIdRegistry extends never ? false : true;

/**
 * Requires `id` once {@link ConfigIdResolved} is `true`; optional otherwise.
 * Intersected into `defineConfig()`'s parameter type so a config that has
 * already had its `id` resolved fails typecheck if `id` is later removed.
 */
export type RequireConfigId = ConfigIdResolved extends true ? { id: string } : { id?: string };

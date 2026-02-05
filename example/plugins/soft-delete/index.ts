/**
 * Soft Delete Plugin
 *
 * Adds soft delete functionality to TailorDB types.
 *
 * @example
 * ```typescript
 * // In tailor.config.ts
 * import { softDeletePlugin } from "./plugins/soft-delete";
 *
 * export const plugins = definePlugins(
 *   softDeletePlugin,
 * );
 *
 * // In your type definition
 * export const user = db.type("User", {
 *   name: db.string(),
 * }).plugin({
 *   "@example/soft-delete": { archiveReason: true },
 * });
 *
 * // Access the generated archive type
 * import { getGeneratedType } from "./plugins/soft-delete";
 * const CustomerArchive = getGeneratedType(customer, "archive");
 * ```
 */

export { softDeletePlugin, getGeneratedType } from "./plugin";
export type { GeneratedTypeKind } from "./plugin";

/**
 * Executor factories for soft-delete plugin.
 * Uses dynamic imports to enable tree-shaking when bundled with inlineDynamicImports.
 */
export const executors = {
  /** @returns Dynamic import of on-delete executor */
  onDelete: () => import("./executors/on-delete"),
};

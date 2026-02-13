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
 *   softDeletePlugin({
 *     archiveTablePrefix: "Deleted_",  // Optional global config
 *   }),
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
export type { GeneratedTypeKind, SoftDeletePluginConfig, SoftDeleteConfig } from "./plugin";

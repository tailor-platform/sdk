/**
 * i18n Plugin
 *
 * A configuration-only plugin that allows defining field labels for internationalization.
 * This plugin doesn't modify types - it only stores i18n configuration that generators
 * can use to produce localized label files.
 *
 * Usage:
 * ```typescript
 * import { db } from "@tailor-platform/sdk";
 *
 * export const user = db.type("User", {
 *   name: db.string(),
 *   email: db.string(),
 * }).plugin({
 *   "@example/i18n": {
 *     labels: {
 *       name: { ja: "名前", en: "Name" },
 *       email: { ja: "メールアドレス", en: "Email" },
 *     },
 *   },
 * });
 * ```
 */

import { t, type PluginBase, type PluginProcessContext } from "@tailor-platform/sdk";

/**
 * Label definition for a single field
 */
export type FieldLabel = Record<string, string>;

/**
 * Configuration options for the i18n plugin
 */
export interface I18nConfig {
  /** Labels for each field, keyed by field name */
  labels: Record<string, FieldLabel>;
  /** Optional type-level label */
  typeLabel?: FieldLabel;
}

/**
 * Process a type with i18n configuration.
 * This plugin doesn't generate types or extend fields - it only stores configuration
 * for generators to use.
 * @param _context - Plugin process context (unused as we don't modify types)
 * @returns Empty plugin output
 */
function processI18n(
  _context: PluginProcessContext<I18nConfig>,
): ReturnType<NonNullable<PluginBase["process"]>> {
  // i18n plugin doesn't modify types - configuration is accessed via generator
  return {};
}

/**
 * i18n plugin that stores field label configuration for internationalization.
 * Use this plugin with a generator to produce localized label files.
 */
export const i18nPlugin: PluginBase = {
  id: "@example/i18n",
  description: "Stores field labels for internationalization",
  importPath: "./plugins/i18n",
  configSchema: t.object({
    labels: t.object({}), // Dynamic object - validated at runtime
    typeLabel: t.object({}, { optional: true }),
  }),
  process: processI18n,
};

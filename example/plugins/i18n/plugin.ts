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
 *       name: { ja: "Name (JA)", en: "Name" },
 *       email: { ja: "Email (JA)", en: "Email" },
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
 * Configuration options for the i18n plugin (generic version for type safety)
 */
export interface I18nConfig<Fields extends string = string> {
  /** Labels for each field, keyed by field name */
  labels: Partial<Record<Fields, FieldLabel>>;
  /** Optional type-level label */
  typeLabel?: FieldLabel;
}

// Note: PluginConfigs extension is auto-generated in user-defined.d.ts
// based on the configTypeTemplate defined below

/**
 * Helper function to create type-safe i18n config.
 * Use this when you want strict field name checking.
 * @example
 * ```typescript
 * .plugin({
 *   "@example/i18n": i18nConfig<typeof myType.fields>()({
 *     labels: { name: { ja: "Name (JA)" } },
 *   }),
 * })
 * ```
 */
export function i18nConfig<Fields extends Record<string, unknown>>() {
  return <C extends I18nConfig<keyof Fields & string>>(config: C): C => config;
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
  typeConfigRequired: true,
  // configSchema is for runtime validation; use simple object for dynamic structures
  // TypeScript type checking is handled by configTypeTemplate
  configSchema: t.object({
    labels: t.object({}, { required: true }),
    typeLabel: t.object({}, { optional: true }),
  }),
  // TypeScript type template for strict field name checking
  // Uses Fields type parameter to constrain label keys to valid field names
  configTypeTemplate:
    "{ labels: Partial<Record<Fields, Record<string, string>>>; typeLabel?: Record<string, string> }",
  process: processI18n,
};

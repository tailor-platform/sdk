/**
 * i18n Plugin & Generator
 *
 * Provides internationalization support for TailorDB types.
 *
 * @example
 * ```typescript
 * // tailordb/user.ts
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
 *
 * // tailor.config.ts
 * import { i18nPlugin, createI18nGenerator } from "./plugins/i18n";
 *
 * export default defineConfig({
 *   plugins: [i18nPlugin],
 *   generators: defineGenerators([
 *     createI18nGenerator({ distPath: "generated/i18n" }),
 *   ]),
 * });
 * ```
 */

export { i18nPlugin, type I18nConfig, type FieldLabel } from "./plugin";
export { createI18nGenerator } from "./generator";

import type { AppConfig } from "#/configure/config/types";
import type { IdPConfig } from "#/configure/services/idp/types";
import type { Plugin } from "#/plugin/types";

type UnknownKeys<Config> = Record<Exclude<keyof Config, keyof AppConfig>, never>;

/**
 * Define a Tailor SDK application configuration with shallow exactness.
 * @template Config
 * @param config - Application configuration
 * @returns The same configuration object
 */
export function defineConfig<
  const Config extends Omit<AppConfig, "idp"> & { idp?: IdPConfig } &
    // type-fest's Exact works recursively and causes type errors, so we use a shallow version here.
    UnknownKeys<Config>,
>(config: Config): Config;
/**
 * Define a Tailor SDK application configuration with `idp` written as an array.
 * @deprecated since NEXT_RELEASE — pass a single IdP (`idp: myIdp`) instead of an array. codemod: v3/idp-array-to-single
 * @template Config
 * @param config - Application configuration
 * @returns The same configuration object
 */
export function defineConfig<
  const Config extends Omit<AppConfig, "idp"> & { idp: IdPConfig[] } & UnknownKeys<Config>,
>(config: Config): Config;
/* @__NO_SIDE_EFFECTS__ */
export function defineConfig(config: AppConfig): AppConfig {
  return config;
}

/**
 * Define plugins to be used with the Tailor SDK.
 * Plugins can generate additional tables, resolvers, and executors
 * based on existing TailorDB tables.
 * The result must be assigned to a named export called `plugins` in `tailor.config.ts`;
 * any other export name is not read.
 *
 * **Beta:** This API may change in future releases.
 * @param configs - Plugin configurations
 * @returns Plugin configurations as given
 */
/* @__NO_SIDE_EFFECTS__ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function definePlugins(...configs: Plugin<any, any>[]) {
  return configs;
}

import type { AppConfig } from "@/configure/config/types";
import type { GeneratorConfig, Plugin } from "@/plugin/types";

/**
 * Define a Tailor SDK application configuration with shallow exactness.
 * @template Config
 * @param config - Application configuration
 * @returns The same configuration object
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineConfig<
  const Config extends AppConfig &
    // type-fest's Exact works recursively and causes type errors, so we use a shallow version here.
    Record<Exclude<keyof Config, keyof AppConfig>, never>,
>(config: Config) {
  return config;
}

/**
 * Define generators to be used with the Tailor SDK.
 * @deprecated Use definePlugins() with generation hooks (onTypeLoaded, generate, etc.) instead.
 * @param configs - Generator configurations
 * @returns Generator configurations as given
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineGenerators(...configs: GeneratorConfig[]) {
  return configs;
}

/**
 * Define plugins to be used with the Tailor SDK.
 * Plugins can generate additional types, resolvers, and executors
 * based on existing TailorDB types.
 * @param configs - Plugin configurations
 * @returns Plugin configurations as given
 */
/* @__NO_SIDE_EFFECTS__ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function definePlugins(...configs: Plugin<any, any>[]) {
  return configs;
}

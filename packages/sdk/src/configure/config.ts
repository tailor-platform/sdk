import type { AppConfig } from "@/parser/app-config/types";
import type { GeneratorConfig } from "@/parser/generator-config/types";
import type { PluginConfig } from "@/parser/plugin-config/types";

/**
 * Define a Tailor SDK application configuration with shallow exactness.
 * @template Config
 * @param config - Application configuration
 * @returns The same configuration object
 */
export function defineConfig<
  const Config extends AppConfig &
    // type-fest's Exact works recursively and causes type errors, so we use a shallow version here.
    Record<Exclude<keyof Config, keyof AppConfig>, never>,
>(config: Config) {
  return config;
}

/**
 * Define generators to be used with the Tailor SDK.
 * @param configs - Generator configurations
 * @returns Generator configurations as given
 */
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
export function definePlugins(...configs: PluginConfig[]) {
  return configs;
}

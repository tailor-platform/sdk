import { CONFIG_SOURCE_DIR, captureCallerDir } from "#/utils/caller-dir";
import type { AppConfig } from "#/configure/config/types";
import type { GeneratorConfig, Plugin } from "#/plugin/types";

/**
 * Define a Tailor SDK application configuration with shallow exactness.
 * @template Config
 * @param config - Application configuration
 * @returns An object with the same configuration; not guaranteed to be the same object reference as `config`
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineConfig<
  const Config extends AppConfig &
    // type-fest's Exact works recursively and causes type errors, so we use a shallow version here.
    Record<Exclude<keyof Config, keyof AppConfig>, never>,
>(config: Config) {
  // Stash where this call itself lives so relative file globs keep resolving
  // against it, even if another module re-exports the returned config as-is.
  // Returns a new object rather than mutating `config` in place, so this
  // stays consistent with the @__NO_SIDE_EFFECTS__ annotation above.
  const sourceDir = captureCallerDir(defineConfig);
  if (!sourceDir) return config;
  return { ...config, [CONFIG_SOURCE_DIR]: sourceDir };
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

import type { AppConfig, BuildOptions } from "#/configure/config/types";

type BuildOptionsSource = Pick<AppConfig, "buildOptions" | "inlineSourcemap" | "logLevel">;

/**
 * Read a config's bundling options from `buildOptions`, falling back to the
 * deprecated top-level `inlineSourcemap` and `logLevel`. Config validation
 * rejects a setting written in both places, so no precedence between them
 * is ever needed.
 * @param config - The loaded app config.
 * @returns The config's bundling options.
 */
export function buildOptionsOf(config: BuildOptionsSource): BuildOptions {
  const { buildOptions = {} } = config;
  return {
    // oxlint-disable-next-line typescript/no-deprecated -- Configs written before buildOptions still set it here.
    inlineSourcemap: buildOptions.inlineSourcemap ?? config.inlineSourcemap,
    // oxlint-disable-next-line typescript/no-deprecated -- Configs written before buildOptions still set it here.
    logLevel: buildOptions.logLevel ?? config.logLevel,
    allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
  };
}

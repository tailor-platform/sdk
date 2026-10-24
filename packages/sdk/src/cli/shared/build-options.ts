import type { AppConfig, BuildOptions } from "#/configure/config/types";
import type { ProjectSourcesFilter } from "./sourcemap-sources";

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
    inlineSourcemapDependencySources: buildOptions.inlineSourcemapDependencySources,
    inlineSourcemapProjectSources: buildOptions.inlineSourcemapProjectSources,
    // oxlint-disable-next-line typescript/no-deprecated -- Configs written before buildOptions still set it here.
    logLevel: buildOptions.logLevel ?? config.logLevel,
    allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
    treeshake: buildOptions.treeshake,
  };
}

/** Parameters for {@link projectSourcesOf}. */
export interface ProjectSourcesOfParams {
  /** The config's bundling options. */
  buildOptions: BuildOptions;
  /** The directory containing the config file, which `inlineSourcemapProjectSources` globs are relative to. */
  baseDir: string;
}

/**
 * Resolve the project-source filter of inline sourcemaps against the config directory.
 * @param params - The bundling options and the config directory
 * @returns The filter, rooted at the config directory
 */
export function projectSourcesOf(params: ProjectSourcesOfParams): ProjectSourcesFilter {
  const { buildOptions, baseDir } = params;
  return { ...buildOptions.inlineSourcemapProjectSources, root: baseDir };
}

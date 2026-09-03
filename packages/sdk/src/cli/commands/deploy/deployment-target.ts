import * as fs from "node:fs";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { hashFile } from "#/cli/cache/hasher";
import { createCacheManager } from "#/cli/cache/manager";
import { loadApplication, type Application } from "#/cli/services/application";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadConfigPath } from "#/cli/shared/context";
import { generateUserTypes } from "#/cli/shared/type-generator";
import { withSpan } from "#/cli/telemetry/index";
import { PluginManager } from "#/plugin/manager";
import { ensureConfigIdForDeploy, warnMissingAppId } from "./config-id-injector";

type LoadedDeployConfig = Awaited<ReturnType<typeof loadConfig>>;

type LoadDeployConfigParams = {
  configPath: string | undefined;
  dryRun: boolean;
  buildOnly: boolean;
};

type LoadDeployConfigsParams = Omit<LoadDeployConfigParams, "configPath"> & {
  configPaths: ReadonlyArray<string | undefined>;
};

type BuildDeploymentTargetParams = {
  configPath: string | undefined;
  loadedConfig?: LoadedDeployConfig;
  dryRun: boolean;
  buildOnly: boolean;
  noCache: boolean;
  packageVersion: string;
  cacheDir: string;
};

export type BuiltDeploymentTarget = {
  config: Awaited<ReturnType<typeof loadConfig>>["config"];
  application: Application;
  workflowBuildResult: Awaited<ReturnType<typeof loadApplication>>["workflowBuildResult"];
  httpAdapterBuildResult: Awaited<ReturnType<typeof loadApplication>>["httpAdapterBuildResult"];
  bundledScripts: Awaited<ReturnType<typeof loadApplication>>["bundledScripts"];
};

type BuildDeploymentTargetsParams = Omit<
  BuildDeploymentTargetParams,
  "configPath" | "loadedConfig"
> & {
  configPaths: ReadonlyArray<string | undefined>;
  loadedConfigs?: ReadonlyArray<LoadedDeployConfig>;
  buildTarget?: (params: BuildDeploymentTargetParams) => Promise<BuiltDeploymentTarget>;
};
/**
 * Parse the deploy config option into one or more config paths.
 * @param configPath - Raw `--config` option value
 * @returns Config paths, or one undefined entry to preserve default config lookup
 */
export function parseDeployConfigPaths(configPath?: string): Array<string | undefined> {
  const rawConfigPath = configPath ?? process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
  if (rawConfigPath === undefined) {
    return [undefined];
  }

  const configPaths = rawConfigPath.split(",").map((entry) => entry.trim());
  if (configPaths.some((entry) => entry.length === 0)) {
    throw new Error("--config must contain one or more non-empty config paths.");
  }
  return configPaths;
}
async function buildDeploymentTarget(
  params: BuildDeploymentTargetParams,
): Promise<BuiltDeploymentTarget> {
  const { configPath, loadedConfig, dryRun, buildOnly, noCache, packageVersion, cacheDir } = params;
  const { config, plugins } =
    loadedConfig ?? (await loadPreparedDeployConfig({ configPath, dryRun, buildOnly }));

  const configDir = path.dirname(config.path);
  const lockfilePath =
    findUpSync("pnpm-lock.yaml", { cwd: configDir }) ??
    findUpSync("package-lock.json", { cwd: configDir }) ??
    findUpSync("yarn.lock", { cwd: configDir }) ??
    findUpSync("bun.lock", { cwd: configDir });
  const cacheManager = createCacheManager({
    enabled: !noCache,
    cacheDir,
    sdkVersion: packageVersion,
    lockfileHash: lockfilePath ? hashFile(lockfilePath) : undefined,
  });

  let pluginManager: PluginManager | undefined;
  if (plugins.length > 0) {
    pluginManager = new PluginManager(plugins);
  }

  await withSpan("build.generateUserTypes", () =>
    generateUserTypes({ config, configPath: config.path }),
  );

  let application: Application;
  let workflowBuildResult: Awaited<ReturnType<typeof loadApplication>>["workflowBuildResult"];
  let httpAdapterBuildResult: Awaited<ReturnType<typeof loadApplication>>["httpAdapterBuildResult"];
  let bundledScripts: Awaited<ReturnType<typeof loadApplication>>["bundledScripts"];
  try {
    const result = await withSpan("build.loadApplication", () =>
      loadApplication({
        config,
        pluginManager,
        bundleCache: cacheManager.bundleCache,
      }),
    );
    application = result.application;
    workflowBuildResult = result.workflowBuildResult;
    httpAdapterBuildResult = result.httpAdapterBuildResult;
    bundledScripts = result.bundledScripts;
  } finally {
    cacheManager.finalize();
  }

  return {
    config,
    application,
    workflowBuildResult,
    httpAdapterBuildResult,
    bundledScripts,
  };
}

function resolveExistingConfigPath(configPath: string | undefined): string | undefined {
  const foundPath = loadConfigPath(configPath);
  if (!foundPath) return undefined;

  const resolvedPath = path.resolve(process.cwd(), foundPath);
  return fs.existsSync(resolvedPath) ? resolvedPath : undefined;
}

async function prepareDeployConfigs(params: LoadDeployConfigsParams): Promise<void> {
  const { configPaths, dryRun, buildOnly } = params;
  const resolvedPaths = new Set(
    configPaths
      .map(resolveExistingConfigPath)
      .filter((configPath): configPath is string => configPath !== undefined),
  );

  await Promise.all(
    [...resolvedPaths].map((configPath) =>
      withSpan("build.prepareConfig", () =>
        ensureConfigIdForDeploy({ configPath, dryRun, buildOnly }),
      ),
    ),
  );
}

async function loadPreparedDeployConfig(
  params: LoadDeployConfigParams,
): Promise<LoadedDeployConfig> {
  return withSpan("build.loadConfig", async () => {
    const { configPath, buildOnly } = params;
    const loaded = await loadConfig(configPath);
    // build-only never reaches the platform, so ownership does not apply.
    if (!buildOnly) warnMissingAppId(loaded.config.id);
    return loaded;
  });
}

export async function loadDeployConfigs(
  params: LoadDeployConfigsParams,
): Promise<LoadedDeployConfig[]> {
  await prepareDeployConfigs(params);
  return Promise.all(
    params.configPaths.map((configPath) => loadPreparedDeployConfig({ ...params, configPath })),
  );
}

export async function buildDeploymentTargets(
  params: BuildDeploymentTargetsParams,
): Promise<BuiltDeploymentTarget[]> {
  const {
    configPaths,
    loadedConfigs: providedLoadedConfigs,
    buildTarget,
    ...targetParams
  } = params;
  const needsConfigPreparation =
    buildTarget === undefined &&
    configPaths.some((_, index) => providedLoadedConfigs?.[index] === undefined);
  if (needsConfigPreparation) {
    await prepareDeployConfigs({
      configPaths,
      dryRun: params.dryRun,
      buildOnly: params.buildOnly,
    });
  }
  const build = buildTarget ?? buildDeploymentTarget;

  return Promise.all(
    configPaths.map((configPath, index) =>
      build({
        ...targetParams,
        configPath,
        loadedConfig: providedLoadedConfigs?.[index],
      }),
    ),
  );
}

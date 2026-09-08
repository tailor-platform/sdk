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
import { assertDefined } from "#/utils/assert";
import {
  type AppIdLock,
  appIdPlanModeForDeploy,
  findAppIdLock,
  resolveLockedAppIds,
} from "./app-id-lock";
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
    loadedConfig ??
    assertDefined(
      (await loadDeployConfigs({ configPaths: [configPath], dryRun, buildOnly }))[0],
      "loaded config missing",
    );

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

// Configs governed by a lock file resolve their id after the module is loaded
// (the lock is compared against the id the module evaluates to), so only
// lock-less configs are prepared here.
async function prepareDeployConfigs(params: LoadDeployConfigsParams): Promise<void> {
  const { configPaths, dryRun, buildOnly } = params;
  if (buildOnly) return;
  const resolvedPaths = new Set(
    configPaths
      .map(resolveExistingConfigPath)
      .filter((configPath): configPath is string => configPath !== undefined),
  );

  await Promise.all(
    [...resolvedPaths].map((configPath) =>
      withSpan("build.prepareConfig", async () => {
        if (findAppIdLock(configPath) !== null) return;
        await ensureConfigIdForDeploy({ configPath, dryRun, buildOnly });
      }),
    ),
  );
}

async function loadPreparedDeployConfig(
  params: LoadDeployConfigParams,
): Promise<LoadedDeployConfig> {
  return withSpan("build.loadConfig", () => loadConfig(params.configPath));
}

type ResolveDeployAppIdsParams = {
  loaded: ReadonlyArray<LoadedDeployConfig>;
  dryRun: boolean;
  buildOnly: boolean;
};

async function resolveDeployAppIds(
  params: ResolveDeployAppIdsParams,
): Promise<LoadedDeployConfig[]> {
  const { loaded, dryRun, buildOnly } = params;
  // build-only never reaches the platform, so ownership does not apply.
  if (buildOnly) return [...loaded];

  const resolved = [...loaded];
  const byLockRoot = new Map<string, { lock: AppIdLock; indexes: number[] }>();
  loaded.forEach((entry, index) => {
    const lock = findAppIdLock(entry.config.path);
    if (lock === null) {
      warnMissingAppId(entry.config.id);
      return;
    }
    const group = byLockRoot.get(lock.root) ?? { lock, indexes: [] };
    group.indexes.push(index);
    byLockRoot.set(lock.root, group);
  });

  const mode = appIdPlanModeForDeploy(dryRun);
  for (const { lock, indexes } of byLockRoot.values()) {
    const plan = await resolveLockedAppIds({
      lock,
      mode,
      entries: indexes.map((index) => {
        const { config } = assertDefined(loaded[index], "loaded config missing");
        return { configPath: config.path, configId: config.id };
      }),
    });
    indexes.forEach((index, position) => {
      const entry = assertDefined(loaded[index], "loaded config missing");
      const id = assertDefined(plan.entries[position], "planned app id entry missing").id;
      resolved[index] = { ...entry, config: { ...entry.config, id } };
    });
  }
  return resolved;
}

export async function loadDeployConfigs(
  params: LoadDeployConfigsParams,
): Promise<LoadedDeployConfig[]> {
  await prepareDeployConfigs(params);
  const loaded = await Promise.all(
    params.configPaths.map((configPath) => loadPreparedDeployConfig({ ...params, configPath })),
  );
  return resolveDeployAppIds({ loaded, dryRun: params.dryRun, buildOnly: params.buildOnly });
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
  if (
    providedLoadedConfigs !== undefined &&
    (providedLoadedConfigs.length !== configPaths.length ||
      configPaths.some((_, index) => providedLoadedConfigs[index] === undefined))
  ) {
    throw new Error("loadedConfigs must contain exactly one entry for every configPath");
  }
  const loadedConfigs =
    buildTarget === undefined && providedLoadedConfigs === undefined
      ? await loadDeployConfigs({
          configPaths,
          dryRun: params.dryRun,
          buildOnly: params.buildOnly,
        })
      : providedLoadedConfigs;
  const build = buildTarget ?? buildDeploymentTarget;

  return Promise.all(
    configPaths.map((configPath, index) =>
      build({
        ...targetParams,
        configPath,
        loadedConfig: loadedConfigs?.[index],
      }),
    ),
  );
}

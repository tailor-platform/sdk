import * as fs from "node:fs";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { hashFile } from "#/cli/cache/hasher";
import { createCacheManager } from "#/cli/cache/manager";
import {
  loadApplication,
  loadWorkspace,
  NO_ENV_OVERRIDES,
  type Application,
  type LoadWorkspaceResult,
  type ConfigServices,
  type EnvOverrides,
  type ServiceSettings,
} from "#/cli/services/application";
import { readDeployConfigPathEnv } from "#/cli/shared/args";
import { type OperatorClient } from "#/cli/shared/client";
import {
  loadConfigFile,
  type LoadedConfig,
  type LoadedConfigFile,
  type LoadedWorkspaceConfig,
} from "#/cli/shared/config-loader";
import { loadConfigPath } from "#/cli/shared/context";
import { CLIError, internalError } from "#/cli/shared/errors";
import { generateUserTypes, generateWorkspaceUserTypes } from "#/cli/shared/type-generator";
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
import { deployApplicationOf, workspaceDeployApplications } from "./deploy-application";
import { applicationOwner } from "./label";
import type { Plugin } from "#/plugin/types";
import type { DeployApplication } from "./deploy-application";
import type { DeployOwner } from "./label";

type LoadedDeployConfig = LoadedConfigFile;

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
  loadedConfig?: LoadedDeployConfig | undefined;
  dryRun: boolean;
  buildOnly: boolean;
  noCache: boolean;
  packageVersion: string;
  cacheDir: string;
  /** Operator client used to resolve `env` static website placeholders while bundling. Omitted in `--build-only`. */
  client?: OperatorClient | undefined;
  /** Workspace ID paired with `client`. */
  workspaceId?: string | undefined;
  /** Static website names planned by any config in the same deploy run. */
  expectedLocalStaticWebsiteNames?: ReadonlySet<string> | undefined;
  /**
   * This same config's own prior build. When present, only `env` resolution
   * and the workflow-job/auth-hook bundles it feeds are redone; everything
   * else (config parsing, TailorDB loading, plugin execution, and the
   * resolver/executor/HTTP-adapter bundles) is reused as-is.
   */
  previous?: BuiltDeploymentTarget | undefined;
};

/** The config file a deployment target builds. */
export type DeploymentSource =
  | { kind: "config"; config: LoadedConfig; application: Application }
  | { kind: "workspace"; workspace: LoadedWorkspaceConfig };

/**
 * Name of the application a `defineConfig()` config deploys, which messages and per-config `--json`
 * fields show.
 * @param source - The config file a target builds
 * @returns The application name, or undefined for a workspace config
 */
export function sourceApplicationName(source: DeploymentSource): string | undefined {
  return source.kind === "config" ? source.application.name : undefined;
}

/**
 * Path of the config file a target builds, which keys per-config state within a deploy run.
 * @param source - The config file a target builds
 * @returns The config file path
 */
export function sourcePath(source: DeploymentSource): string {
  return source.kind === "config" ? source.config.path : source.workspace.path;
}

/**
 * Settings a loaded config file's services share.
 * @param entry - A loaded config file of either kind
 * @returns Its settings
 */
export function loadedSettings(entry: LoadedConfigFile): ServiceSettings {
  return entry.kind === "config" ? entry.config : entry.workspace;
}

export type BuiltDeploymentTarget = {
  plugins: readonly Plugin[];
  /** The config file this target builds, with the application a `defineConfig()` config deploys. */
  source: DeploymentSource;
  /** Settings the config's services share. */
  config: ServiceSettings;
  /** The services the config defines. */
  application: ConfigServices;
  /** `env` values each service uses in place of the root values with the same keys. */
  envOverrides: EnvOverrides;
  /** Owner of the resources the config deploys. */
  owner: DeployOwner;
  /** Applications the config deploys. */
  applications: ReadonlyArray<DeployApplication>;
  workflowBuildResult: Awaited<ReturnType<typeof loadApplication>>["workflowBuildResult"];
  httpAdapterBuildResult: Awaited<ReturnType<typeof loadApplication>>["httpAdapterBuildResult"];
  bundledScripts: Awaited<ReturnType<typeof loadApplication>>["bundledScripts"];
  reusableBuildState: Awaited<ReturnType<typeof loadApplication>>["reusableBuildState"];
};

type BuildDeploymentTargetsParams = Omit<
  BuildDeploymentTargetParams,
  "configPath" | "loadedConfig" | "previous"
> & {
  configPaths: ReadonlyArray<string | undefined>;
  loadedConfigs?: ReadonlyArray<LoadedDeployConfig> | undefined;
  buildTarget?:
    | ((params: BuildDeploymentTargetParams) => Promise<BuiltDeploymentTarget>)
    | undefined;
  /** Prior builds, matched to `configPaths` by index (same array, same order). */
  previousTargets?: ReadonlyArray<BuiltDeploymentTarget> | undefined;
};
/**
 * Parse the deploy config option into one or more config paths.
 * @param configPath - Raw `--config` option value
 * @returns Config paths, or one undefined entry to preserve default config lookup
 */
export function parseDeployConfigPaths(configPath?: string): Array<string | undefined> {
  const rawConfigPath = configPath ?? readDeployConfigPathEnv();
  if (rawConfigPath === undefined) {
    return [undefined];
  }

  const configPaths = rawConfigPath.split(",").map((entry) => entry.trim());
  if (configPaths.some((entry) => entry.length === 0)) {
    throw CLIError({
      code: "DEPLOY_CONFIG_REQUIRED",
      message: "--config must contain one or more non-empty config paths.",
      command: "deploy",
    });
  }
  return configPaths;
}
async function buildDeploymentTarget(
  params: BuildDeploymentTargetParams,
): Promise<BuiltDeploymentTarget> {
  const {
    configPath,
    loadedConfig,
    dryRun,
    buildOnly,
    noCache,
    packageVersion,
    cacheDir,
    client,
    workspaceId,
    expectedLocalStaticWebsiteNames,
    previous,
  } = params;
  const loaded =
    loadedConfig ??
    assertDefined(
      (await loadDeployConfigs({ configPaths: [configPath], dryRun, buildOnly }))[0],
      "loaded config missing",
    );
  const { plugins } = loaded;
  const settings = loadedSettings(loaded);

  const configDir = path.dirname(settings.path);
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
  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const loadParams = {
    pluginManager,
    bundleCache: cacheManager.bundleCache,
    client,
    workspaceId,
    expectedLocalStaticWebsiteNames,
  };

  // Generated types are derived from config/TailorDB shape, not `env`, so a
  // reload reusing `previous` would regenerate identical output.
  if (!previous) {
    await withSpan("build.generateUserTypes", () =>
      loaded.kind === "config"
        ? generateUserTypes({ config: loaded.config, configPath: loaded.config.path })
        : generateWorkspaceUserTypes({ workspace: loaded.workspace }),
    );
  }

  try {
    if (loaded.kind === "workspace") {
      const { workspace } = loaded;
      const result = await withSpan("build.loadWorkspace", () =>
        loadWorkspace({
          ...loadParams,
          workspace,
          previous: previous && {
            ...previous,
            services: {
              ...previous.application,
              settings: previous.config,
              envOverrides: previous.envOverrides,
            },
          },
        }),
      );
      const { services } = result;
      const applications = workspaceDeployApplications(workspace.apps);
      assertHttpAdaptersHaveOneApplication(services, applications);
      return {
        plugins,
        source: { kind: "workspace", workspace },
        config: services.settings,
        application: services,
        envOverrides: services.envOverrides,
        owner: { kind: "workspace" },
        applications,
        ...bundlesOf(result),
      };
    }

    const { config } = loaded;
    const result = await withSpan("build.loadApplication", () =>
      loadApplication({
        ...loadParams,
        config,
        previous:
          previous?.source.kind === "config"
            ? { ...previous, application: previous.source.application }
            : undefined,
      }),
    );
    const { application } = result;
    return {
      plugins,
      source: { kind: "config", config, application },
      config,
      application,
      envOverrides: NO_ENV_OVERRIDES,
      owner: applicationOwner(application),
      applications: [deployApplicationOf(application)],
      ...bundlesOf(result),
    };
  } finally {
    cacheManager.finalize();
  }
}

/**
 * Stop a workspace config whose HTTP adapters have no single application to run on.
 * @param services - The workspace's services
 * @param applications - The applications the workspace deploys
 */
export function assertHttpAdaptersHaveOneApplication(
  services: Pick<ConfigServices, "httpAdapterService">,
  applications: ReadonlyArray<DeployApplication>,
): void {
  if ((services.httpAdapterService?.adapters.length ?? 0) === 0 || applications.length === 1) {
    return;
  }
  const names = applications.map(({ name }) => name);
  throw CLIError({
    code: "HTTP_ADAPTER_MULTIPLE_APPLICATIONS",
    message: `HTTP adapters run on the application of a workspace config, but its apps lists ${names.length === 0 ? "none" : `${names.length}: ${names.join(", ")}`}.`,
    suggestion: "Keep one application in apps, or remove httpAdapter from the workspace config.",
    context: { applications: names },
  });
}

type TargetBundles = Pick<
  BuiltDeploymentTarget,
  "workflowBuildResult" | "httpAdapterBuildResult" | "bundledScripts" | "reusableBuildState"
>;

function bundlesOf(result: Omit<LoadWorkspaceResult, "services">): TargetBundles {
  return {
    workflowBuildResult: result.workflowBuildResult,
    httpAdapterBuildResult: result.httpAdapterBuildResult,
    bundledScripts: result.bundledScripts,
    reusableBuildState: result.reusableBuildState,
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
  return withSpan("build.loadConfig", () => loadConfigFile(params.configPath));
}

function assertWorkspaceConfigAlone(loaded: ReadonlyArray<LoadedDeployConfig>): void {
  if (loaded.length < 2) return;
  const workspace = loaded.find((entry) => entry.kind === "workspace");
  if (!workspace) return;
  throw CLIError({
    code: "DEPLOY_WORKSPACE_CONFIG_WITH_OTHERS",
    message: `A config defined with defineWorkspace() or defineApp() deploys alone, but --config also names ${loaded.length - 1} other config(s).`,
    suggestion: "Deploy the workspace config on its own, or move the other configs into it.",
    context: { configPath: workspace.workspace.path },
    command: "deploy",
  });
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
    if (entry.kind === "workspace") return;
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
        const { config } = loadedApplicationConfig(loaded, index);
        return { configPath: config.path, configId: config.id };
      }),
    });
    indexes.forEach((index, position) => {
      const entry = loadedApplicationConfig(loaded, index);
      const id = assertDefined(plan.entries[position], "planned app id entry missing").id;
      resolved[index] = { ...entry, config: { ...entry.config, id } };
    });
  }
  return resolved;
}

function loadedApplicationConfig(
  loaded: ReadonlyArray<LoadedDeployConfig>,
  index: number,
): Extract<LoadedDeployConfig, { kind: "config" }> {
  const entry = assertDefined(loaded[index], "loaded config missing");
  if (entry.kind !== "config") throw internalError("expected a defineConfig() config");
  return entry;
}

export async function loadDeployConfigs(
  params: LoadDeployConfigsParams,
): Promise<LoadedDeployConfig[]> {
  await prepareDeployConfigs(params);
  const loaded = await Promise.all(
    params.configPaths.map((configPath) => loadPreparedDeployConfig({ ...params, configPath })),
  );
  assertWorkspaceConfigAlone(loaded);
  return resolveDeployAppIds({ loaded, dryRun: params.dryRun, buildOnly: params.buildOnly });
}

export async function buildDeploymentTargets(
  params: BuildDeploymentTargetsParams,
): Promise<BuiltDeploymentTarget[]> {
  const {
    configPaths,
    loadedConfigs: providedLoadedConfigs,
    buildTarget,
    previousTargets,
    ...targetParams
  } = params;
  if (
    providedLoadedConfigs !== undefined &&
    (providedLoadedConfigs.length !== configPaths.length ||
      configPaths.some((_, index) => providedLoadedConfigs[index] === undefined))
  ) {
    throw internalError("loadedConfigs must contain exactly one entry for every configPath");
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
        previous: previousTargets?.[index],
      }),
    ),
  );
}

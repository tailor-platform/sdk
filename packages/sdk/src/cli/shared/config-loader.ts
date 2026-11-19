import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { parseConfigExport } from "#/parser/app-config/workspace";
import { PluginConfigSchema } from "#/parser/plugin-config/index";
import { isPluginValidationError } from "#/utils/plugin-validation-error";
import { loadConfigPath } from "./context";
import { assertEnvHasNoSecrets, resolveEnvValue } from "./env-secret-scan";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";
import { CLIError } from "./errors";
import { installCliTailordbStub } from "./mock";
import { currentImportNonce, IMPORT_NONCE_PARAM } from "./user-modules";
import {
  atUserModule,
  configInvalidError,
  configIssuesError,
  syntaxInvalidError,
} from "./validation-errors";
import { flattenZodIssues, type FlatIssue } from "./zod-issues";
import type { AppConfig, EnvEntry, EnvValue } from "#/configure/config/types";
import type { ParsedWorkspaceConfig } from "#/parser/app-config/types";
import type { Plugin } from "#/plugin/types";

/**
 * App config whose `env` entries have been resolved to the values that get
 * deployed: the `{ value, allowSecretReason }` form accepted in `defineConfig`
 * is unwrapped during loading, so nothing downstream can deploy a wrapper
 * object or the reason string alongside the value.
 */
export type ResolvedEnvAppConfig = Omit<AppConfig, "env"> & {
  env?: Record<string, EnvValue>;
};

/** Loaded configuration with resolved path. */
export type LoadedConfig = ResolvedEnvAppConfig & { path: string };

/** A `defineWorkspace()` or `defineApp()` config with its `env` values resolved, and its path. */
export type LoadedWorkspaceConfig = ParsedWorkspaceConfig<EnvValue> & { path: string };

/** A loaded config file, told apart by the function that defined its default export. */
export type LoadedConfigFile =
  | { kind: "config"; config: LoadedConfig; plugins: Plugin[] }
  | { kind: "workspace"; workspace: LoadedWorkspaceConfig; plugins: Plugin[] };

const CONFIG_NOT_FOUND_SUGGESTION =
  "Run the command from the app directory, or pass the config file with --config.";

export interface LoadConfigOptions {
  /** Import cache-busting value for callers that reload the config module after a rebuild. */
  importNonce?: string;
}

/**
 * Load Tailor configuration file and associated plugins.
 * @param configPath - Optional explicit config path
 * @param options - Optional module import behavior.
 * @returns Loaded config, plugins, and config path
 */
export async function loadConfig(
  configPath?: string,
  options: LoadConfigOptions = {},
): Promise<{ config: LoadedConfig; plugins: Plugin[] }> {
  const loaded = await loadConfigFile(configPath, options);
  if (loaded.kind === "workspace") {
    throw atUserModule(
      CLIError({
        code: "CONFIG_KIND_UNSUPPORTED",
        message:
          "This command does not support a config defined with defineWorkspace() or defineApp().",
      }),
      loaded.workspace.path,
    );
  }
  return { config: loaded.config, plugins: loaded.plugins };
}

function resolveEnv(env: Record<string, EnvEntry>): Record<string, EnvValue> {
  return Object.fromEntries(
    Object.entries(env).map(([key, entry]) => [key, resolveEnvValue(entry)]),
  );
}

function resolveEnvRecords(
  records: Record<string, Record<string, EnvEntry>>,
): Record<string, Record<string, EnvValue>> {
  return Object.fromEntries(Object.entries(records).map(([name, env]) => [name, resolveEnv(env)]));
}

/**
 * Load a Tailor configuration file of any kind and its plugins.
 * @param configPath - Optional explicit config path
 * @param options - Optional module import behavior.
 * @returns The `defineConfig()` config, or the workspace a `defineWorkspace()` or `defineApp()` config describes, with its plugins
 */
export async function loadConfigFile(
  configPath?: string,
  options: LoadConfigOptions = {},
): Promise<LoadedConfigFile> {
  installCliTailordbStub();
  const foundPath = loadConfigPath(configPath);
  if (!foundPath) {
    throw CLIError({
      code: "CONFIG_NOT_FOUND",
      message:
        "Configuration file not found: tailor.config.ts not found in current or parent directories",
      suggestion: CONFIG_NOT_FOUND_SUGGESTION,
    });
  }
  const resolvedPath = path.resolve(process.cwd(), foundPath);

  if (!fs.existsSync(resolvedPath)) {
    throw CLIError({
      code: "CONFIG_NOT_FOUND",
      message: `Configuration file not found: ${foundPath}`,
      suggestion: "Check the path given with --config or TAILOR_CONFIG_PATH.",
      context: { file: resolvedPath },
    });
  }

  const configUrl = pathToFileURL(resolvedPath);
  const importNonce = options.importNonce ?? currentImportNonce();
  if (importNonce) {
    configUrl.searchParams.set(IMPORT_NONCE_PARAM, importNonce);
  }
  let configModule: unknown;
  try {
    configModule = await import(configUrl.href);
  } catch (error) {
    throw atConfigSource(error, resolvedPath);
  }
  if (
    typeof configModule !== "object" ||
    configModule === null ||
    !("default" in configModule) ||
    !configModule.default
  ) {
    throw configIssuesError({
      file: resolvedPath,
      exportName: "default",
      subject: "Tailor config",
      issues: [{ path: [], message: "default export not found" }],
      suggestion: "Export the config as the default export: export default defineConfig({ ... })",
    });
  }

  const parsed = parseConfigExport(configModule.default);
  if (!parsed.success) {
    throw configInvalidError({
      file: resolvedPath,
      exportName: "default",
      subject: "Tailor config",
      error: parsed.error,
    });
  }

  if (parsed.data.kind === "config") {
    await assertEnvHasNoSecrets({ env: parsed.data.config.env, configPath: resolvedPath });
  } else {
    const { env, envOverrides } = parsed.data.workspace;
    await assertEnvHasNoSecrets({
      env,
      overrides: [
        ...Object.entries(envOverrides.resolver).map(([name, overrides]) => ({
          owner: ["resolver", name],
          env: overrides,
        })),
        ...(envOverrides.executor ? [{ owner: ["executor"], env: envOverrides.executor }] : []),
        ...(envOverrides.workflow ? [{ owner: ["workflow"], env: envOverrides.workflow }] : []),
        ...Object.entries(envOverrides.auth).map(([name, overrides]) => ({
          owner: ["auth", name],
          env: overrides,
        })),
      ],
      configPath: resolvedPath,
    });
  }

  const allPlugins: Plugin[] = [];
  if (Object.hasOwn(configModule, "plugins")) {
    const pluginsExport = (configModule as Record<string, unknown>).plugins;
    const pluginsTarget = {
      file: resolvedPath,
      exportName: "plugins",
      subject: "`plugins` export",
    } as const;
    if (!Array.isArray(pluginsExport)) {
      throw configIssuesError({
        ...pluginsTarget,
        issues: [
          {
            path: [],
            message: `expected an array returned by definePlugins(), got ${pluginsExport === null ? "null" : typeof pluginsExport}`,
          },
        ],
      });
    }
    const issues: FlatIssue[] = [];
    const seenIds = new Set<string>();
    let hasDuplicateId = false;
    for (const [index, item] of pluginsExport.entries()) {
      const result = PluginConfigSchema.safeParse(item);
      if (!result.success) {
        issues.push(...flattenZodIssues(result.error.issues, [index]));
        continue;
      }
      if (seenIds.has(result.data.id)) {
        issues.push({ path: [index, "id"], message: `Duplicate plugin ID "${result.data.id}"` });
        hasDuplicateId = true;
        continue;
      }
      seenIds.add(result.data.id);
      // Not result.data: parsing copies into a plain object, dropping a class plugin's methods and private state.
      allPlugins.push(item as Plugin);
    }
    if (issues.length > 0) {
      throw configIssuesError({
        ...pluginsTarget,
        issues,
        suggestion: hasDuplicateId ? "Give each plugin a unique ID." : undefined,
      });
    }
  }

  if (parsed.data.kind === "config") {
    const appConfig: AppConfig = parsed.data.config;
    return {
      kind: "config",
      config: {
        ...appConfig,
        ...(appConfig.env ? { env: resolveEnv(appConfig.env) } : {}),
        path: resolvedPath,
      } as LoadedConfig,
      plugins: allPlugins,
    };
  }
  const { workspace } = parsed.data;
  const { executor, workflow, resolver, auth } = workspace.envOverrides;
  return {
    kind: "workspace",
    workspace: {
      ...workspace,
      env: resolveEnv(workspace.env),
      envOverrides: {
        resolver: resolveEnvRecords(resolver),
        ...(executor ? { executor: resolveEnv(executor) } : {}),
        ...(workflow ? { workflow: resolveEnv(workflow) } : {}),
        auth: resolveEnvRecords(auth),
      },
      path: resolvedPath,
    },
    plugins: allPlugins,
  };
}

/**
 * Point a failure raised while importing the config at the source it came from.
 *
 * Unparsable source names the file it was found in, which is the imported
 * module rather than the config when the config imports it. Anything else is
 * attributed to the config file, the one location loading it establishes, and
 * a failure that already carries a source location keeps it.
 * @param error - Value thrown while importing the config
 * @param resolvedPath - Absolute path to the config file
 * @returns An Error carrying the source location the failure points at
 */
export function atConfigSource(error: unknown, resolvedPath: string): unknown {
  if (isPluginValidationError(error)) {
    return atUserModule(
      withErrorDiagnostics(
        CLIError({
          code: error.code,
          message: error.message,
          suggestion: error.suggestion,
          context: error.context,
          cause: error,
        }),
        getErrorDiagnostics(error),
      ),
      resolvedPath,
    );
  }
  return syntaxInvalidError(error) ?? atUserModule(error, resolvedPath);
}

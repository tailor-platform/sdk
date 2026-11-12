import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { AppConfigSchema } from "#/parser/app-config/schema";
import { PluginConfigSchema } from "#/parser/plugin-config/index";
import { loadConfigPath } from "./context";
import { assertEnvHasNoSecrets, resolveEnvValue } from "./env-secret-scan";
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
import type { AppConfig, EnvValue } from "#/configure/config/types";
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

  const validated = AppConfigSchema.safeParse(configModule.default);
  if (!validated.success) {
    throw configInvalidError({
      file: resolvedPath,
      exportName: "default",
      subject: "Tailor config",
      error: validated.error,
    });
  }

  const appConfig = configModule.default as AppConfig;
  await assertEnvHasNoSecrets({ env: appConfig.env, configPath: resolvedPath });
  const env = appConfig.env
    ? Object.fromEntries(
        Object.entries(appConfig.env).map(([key, entry]) => [key, resolveEnvValue(entry)]),
      )
    : undefined;

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

  return {
    config: {
      ...appConfig,
      ...(env ? { env } : {}),
      path: resolvedPath,
    } as LoadedConfig,
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
  return syntaxInvalidError(error) ?? atUserModule(error, resolvedPath);
}

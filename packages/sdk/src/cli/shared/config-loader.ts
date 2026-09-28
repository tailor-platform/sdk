import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { AppConfigSchema } from "#/parser/app-config/schema";
import { PluginConfigSchema } from "#/parser/plugin-config/index";
import { loadConfigPath } from "./context";
import { assertEnvHasNoSecrets, resolveEnvValue } from "./env-secret-scan";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";
import { installCliTailordbStub } from "./mock";
import { currentImportNonce, IMPORT_NONCE_PARAM } from "./user-modules";
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
    throw new Error(
      "Configuration file not found: tailor.config.ts not found in current or parent directories",
    );
  }
  const resolvedPath = path.resolve(process.cwd(), foundPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
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
    throw atConfigFile(
      new Error("Invalid Tailor config module: default export not found"),
      resolvedPath,
    );
  }

  const validated = AppConfigSchema.safeParse(configModule.default);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw atConfigFile(
      new Error(`Invalid Tailor config in ${resolvedPath}:\n${issues}`),
      resolvedPath,
    );
  }

  const appConfig = configModule.default as AppConfig;
  try {
    await assertEnvHasNoSecrets({ env: appConfig.env, configPath: resolvedPath });
  } catch (error) {
    throw error instanceof Error ? atConfigFile(error, resolvedPath) : error;
  }
  const env = appConfig.env
    ? Object.fromEntries(
        Object.entries(appConfig.env).map(([key, entry]) => [key, resolveEnvValue(entry)]),
      )
    : undefined;

  const allPlugins: Plugin[] = [];
  if (Object.hasOwn(configModule, "plugins")) {
    const pluginsExport = (configModule as Record<string, unknown>).plugins;
    if (!Array.isArray(pluginsExport)) {
      throw atConfigFile(
        new Error(
          `Invalid \`plugins\` export in ${resolvedPath}: expected an array returned by definePlugins(), got ${typeof pluginsExport}`,
        ),
        resolvedPath,
      );
    }
    const seenIds = new Set<string>();
    for (const item of pluginsExport) {
      const result = PluginConfigSchema.safeParse(item);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
        throw atConfigFile(
          new Error(`Invalid \`plugins\` export in ${resolvedPath}:\n${issues}`),
          resolvedPath,
        );
      }
      if (seenIds.has(result.data.id)) {
        throw atConfigFile(
          new Error(
            `Duplicate plugin ID "${result.data.id}" detected in ${resolvedPath}. Each plugin must have a unique ID.`,
          ),
          resolvedPath,
        );
      }
      seenIds.add(result.data.id);
      // Not result.data: parsing copies into a plain object, dropping a class plugin's methods and private state.
      allPlugins.push(item as Plugin);
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
 * Point a config rejection at the file it came from.
 * @param error - Failure raised while loading the config
 * @param resolvedPath - Absolute path to the config file
 * @returns The same error, carrying the config file as its source location
 */
function atConfigFile<T extends Error>(error: T, resolvedPath: string): T {
  return withErrorDiagnostics(error, { location: { file: resolvedPath } });
}

/**
 * Diagnostic the TypeScript transform throws for source it cannot parse.
 *
 * It arrives as a plain object rather than an Error, so a failure to parse the
 * config would otherwise reach the caller as `[object Object]`.
 */
interface SyntaxDiagnostic {
  code: "InvalidSyntax";
  message: string;
  filename: string;
  startLine?: number;
}

function isSyntaxDiagnostic(value: unknown): value is SyntaxDiagnostic {
  if (typeof value !== "object" || value === null || value instanceof Error) return false;
  const { code, message, filename, startLine } = value as Record<string, unknown>;
  return (
    code === "InvalidSyntax" &&
    typeof message === "string" &&
    typeof filename === "string" &&
    (startLine === undefined || typeof startLine === "number")
  );
}

/**
 * Point a failure raised while importing the config at the source it came from.
 *
 * Unparsable source names the file it was found in, which is the imported
 * module rather than the config when the config imports it. Anything else is
 * attributed to the config file, the one location loading it establishes, and
 * a failure that already names its own source keeps it.
 * @param error - Value thrown while importing the config
 * @param resolvedPath - Absolute path to the config file
 * @returns An Error carrying the source location the failure points at
 */
export function atConfigSource(error: unknown, resolvedPath: string): unknown {
  if (isSyntaxDiagnostic(error)) {
    return withErrorDiagnostics(new SyntaxError(error.message, { cause: error }), {
      location: {
        file: error.filename,
        ...(error.startLine === undefined ? {} : { line: error.startLine }),
      },
    });
  }
  if (!(error instanceof Error)) return error;
  return getErrorDiagnostics(error).location ? error : atConfigFile(error, resolvedPath);
}

import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { AppConfigSchema } from "#/parser/app-config/schema";
import { PluginConfigSchema } from "#/parser/plugin-config/index";
import { loadConfigPath } from "./context";
import { assertEnvHasNoSecrets, resolveEnvValue } from "./env-secret-scan";
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
  const configModule: unknown = await import(configUrl.href);
  if (
    typeof configModule !== "object" ||
    configModule === null ||
    !("default" in configModule) ||
    !configModule.default
  ) {
    throw new Error("Invalid Tailor config module: default export not found");
  }

  const validated = AppConfigSchema.safeParse(configModule.default);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Tailor config in ${resolvedPath}:\n${issues}`);
  }

  const appConfig = configModule.default as AppConfig;
  await assertEnvHasNoSecrets({ env: appConfig.env, configPath: resolvedPath });
  const env = appConfig.env
    ? Object.fromEntries(
        Object.entries(appConfig.env).map(([key, entry]) => [key, resolveEnvValue(entry)]),
      )
    : undefined;

  // The only export read for plugins is `plugins`, the result of definePlugins().
  const allPlugins: Plugin[] = [];
  const pluginsExport = (configModule as Record<string, unknown>).plugins;
  if (pluginsExport !== undefined) {
    if (!Array.isArray(pluginsExport)) {
      throw new Error(
        `Invalid \`plugins\` export in ${resolvedPath}: expected an array returned by definePlugins(), got ${typeof pluginsExport}`,
      );
    }
    const seenIds = new Set<string>();
    for (const item of pluginsExport) {
      const result = PluginConfigSchema.safeParse(item);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
        throw new Error(`Invalid \`plugins\` export in ${resolvedPath}:\n${issues}`);
      }
      if (seenIds.has(result.data.id)) {
        throw new Error(
          `Duplicate plugin ID "${result.data.id}" detected. Each plugin must have a unique ID.`,
        );
      }
      seenIds.add(result.data.id);
      allPlugins.push(result.data);
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

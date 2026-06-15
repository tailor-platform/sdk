import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { AppConfigSchema } from "@/parser/app-config/schema";
import { PluginConfigSchema } from "@/parser/plugin-config";
import { loadConfigPath } from "./context";
import { installCliTailordbStub } from "./mock";
import type { AnyCodeGenerator } from "@/cli/commands/generate/types";
import type { AppConfig } from "@/types/app-config";
import type { Plugin } from "@/types/plugin";

/**
 * Loaded configuration with resolved path
 */
export type LoadedConfig = AppConfig & { path: string };

export interface LoadConfigOptions {
  /** Import cache-busting value for watch-mode reloads. */
  importNonce?: string;
}

export type Generator = AnyCodeGenerator;

/**
 * Load Tailor configuration file and associated plugins.
 * @param configPath - Optional explicit config path
 * @param options - Optional module import behavior.
 * @returns Loaded config, generators, plugins, and config path
 */
export async function loadConfig(
  configPath?: string,
  options: LoadConfigOptions = {},
): Promise<{ config: LoadedConfig; generators: Generator[]; plugins: Plugin[] }> {
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
  if (options.importNonce) {
    configUrl.searchParams.set("tailorImportNonce", options.importNonce);
  }
  const configModule = await import(configUrl.href);
  if (!configModule || !configModule.default) {
    throw new Error("Invalid Tailor config module: default export not found");
  }

  const validated = AppConfigSchema.safeParse(configModule.default);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Tailor config in ${resolvedPath}:\n${issues}`);
  }

  // Collect all plugin exports (plugins, plugins2, etc.)
  const allPlugins: Plugin[] = [];

  for (const value of Object.values(configModule)) {
    if (Array.isArray(value)) {
      const pluginParsed = value.reduce(
        (acc, item) => {
          if (!acc.success) return acc;

          const result = PluginConfigSchema.safeParse(item);
          if (result.success) {
            acc.items.push(result.data);
          } else {
            acc.success = false;
          }
          return acc;
        },
        { success: true, items: [] as Plugin[] },
      );
      if (pluginParsed.success && pluginParsed.items.length > 0) {
        allPlugins.push(...pluginParsed.items);
      }
    }
  }

  return {
    config: { ...configModule.default, path: resolvedPath } as LoadedConfig,
    generators: [],
    plugins: allPlugins,
  };
}

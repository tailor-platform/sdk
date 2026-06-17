import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { AppConfigSchema } from "#src/parser/app-config/schema";
import {
  CodeGeneratorSchema,
  BaseGeneratorConfigSchema,
} from "#src/parser/generator-config/schema";
import { PluginConfigSchema } from "#src/parser/plugin-config/index";
import { builtinPlugins } from "#src/plugin/builtin/registry";
import { loadConfigPath } from "./context";
import { installCliTailordbStub } from "./mock";
import type { AppConfig } from "#src/configure/config/types";
import type { Plugin } from "#src/plugin/types";
import type { z } from "zod";

/**
 * Loaded configuration with resolved path
 */
export type LoadedConfig = AppConfig & { path: string };

export interface LoadConfigOptions {
  /** Import cache-busting value for watch-mode reloads. */
  importNonce?: string;
}

// Generator schema for custom CodeGenerator objects (builtin generators are handled as plugins)
const GeneratorConfigSchema = CodeGeneratorSchema.brand("CodeGenerator");

export type Generator = z.output<typeof GeneratorConfigSchema>;

/**
 * Load Tailor configuration file and associated generators and plugins.
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

  // Collect all generator exports (generators, generators2, etc.)
  const allGenerators: Generator[] = [];
  // Collect all plugin exports (plugins, plugins2, etc.)
  const allPlugins: Plugin[] = [];

  for (const value of Object.values(configModule)) {
    if (Array.isArray(value)) {
      // Try to parse as generators (converting builtin tuples to plugins)
      const generatorParsed = value.reduce(
        (acc, item) => {
          if (!acc.success) return acc;

          // Check if this is a builtin generator tuple that should be converted to a plugin
          const baseResult = BaseGeneratorConfigSchema.safeParse(item);
          if (baseResult.success && Array.isArray(baseResult.data)) {
            const [id, options] = baseResult.data as [string, Record<string, unknown>];
            const pluginFactory = builtinPlugins.get(id);
            if (pluginFactory) {
              acc.convertedPlugins.push(pluginFactory(options));
              return acc;
            }
          }

          // Try to parse as a custom CodeGenerator object
          const result = GeneratorConfigSchema.safeParse(item);
          if (result.success) {
            acc.items.push(result.data);
          } else {
            acc.success = false;
          }
          return acc;
        },
        { success: true, items: [] as Generator[], convertedPlugins: [] as Plugin[] },
      );
      if (
        generatorParsed.success &&
        (generatorParsed.items.length > 0 || generatorParsed.convertedPlugins.length > 0)
      ) {
        allGenerators.push(...generatorParsed.items);
        allPlugins.push(...generatorParsed.convertedPlugins);
        continue;
      }

      // Try to parse as plugins
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
    generators: allGenerators,
    plugins: allPlugins,
  };
}

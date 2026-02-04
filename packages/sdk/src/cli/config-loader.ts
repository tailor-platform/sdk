import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import {
  createGeneratorConfigSchema,
  type CodeGeneratorBase,
  type Generator,
} from "@/parser/generator-config";
import { createPluginConfigSchema, type PluginBase, type Plugin } from "@/parser/plugin-config";
import { changesetPlugin, auditLogPlugin } from "@/plugin/builtin";
import { loadConfigPath } from "./context";
import {
  createEnumConstantsGenerator,
  EnumConstantsGeneratorID,
} from "./generator/builtin/enum-constants";
import { createFileUtilsGenerator, FileUtilsGeneratorID } from "./generator/builtin/file-utils";
import { createKyselyGenerator, KyselyGeneratorID } from "./generator/builtin/kysely-type";
import { createSeedGenerator, SeedGeneratorID } from "./generator/builtin/seed";
import type { AppConfig } from "@/parser/app-config";
import "./mock";

/**
 * Loaded configuration with resolved path
 */
export type LoadedConfig = AppConfig & { path: string };

// Register built-in generators with their constructor functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const builtinGenerators = new Map<string, (options: any) => CodeGeneratorBase>([
  [KyselyGeneratorID, (options: { distPath: string }) => createKyselyGenerator(options)],
  [SeedGeneratorID, (options: { distPath: string }) => createSeedGenerator(options)],
  [
    EnumConstantsGeneratorID,
    (options: { distPath: string }) => createEnumConstantsGenerator(options),
  ],
  [FileUtilsGeneratorID, (options: { distPath: string }) => createFileUtilsGenerator(options)],
]);

export const GeneratorConfigSchema = createGeneratorConfigSchema(builtinGenerators);

// Register built-in plugins with their constructor functions
const builtinPlugins = new Map<string, (options: unknown) => PluginBase>([
  [changesetPlugin.id, () => changesetPlugin],
  [auditLogPlugin.id, () => auditLogPlugin],
]);

const PluginConfigSchema = createPluginConfigSchema(builtinPlugins);

/**
 * Load Tailor configuration file and associated generators and plugins.
 * @param configPath - Optional explicit config path
 * @returns Loaded config, generators, plugins, and config path
 */
export async function loadConfig(
  configPath?: string,
): Promise<{ config: LoadedConfig; generators: Generator[]; plugins: Plugin[] }> {
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

  const configModule = await import(pathToFileURL(resolvedPath).href);
  if (!configModule || !configModule.default) {
    throw new Error("Invalid Tailor config module: default export not found");
  }

  // Collect all generator exports (generators, generators2, etc.)
  const allGenerators: Generator[] = [];
  // Collect all plugin exports (plugins, plugins2, etc.)
  const allPlugins: Plugin[] = [];

  for (const value of Object.values(configModule)) {
    if (Array.isArray(value)) {
      // Try to parse as generators
      const generatorParsed = value.reduce(
        (acc, item) => {
          if (!acc.success) return acc;

          const result = GeneratorConfigSchema.safeParse(item);
          if (result.success) {
            acc.items.push(result.data);
          } else {
            acc.success = false;
          }
          return acc;
        },
        { success: true, items: [] as Generator[] },
      );
      if (generatorParsed.success && generatorParsed.items.length > 0) {
        allGenerators.push(...generatorParsed.items);
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

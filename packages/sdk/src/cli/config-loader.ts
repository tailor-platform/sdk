import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import {
  createGeneratorConfigSchema,
  type CodeGeneratorBase,
  type Generator,
} from "@/parser/generator-config";
import { loadConfigPath } from "./context";
import {
  EnumConstantsGenerator,
  EnumConstantsGeneratorID,
} from "./generator/builtin/enum-constants";
import { FileUtilsGenerator, FileUtilsGeneratorID } from "./generator/builtin/file-utils";
import { KyselyGenerator, KyselyGeneratorID } from "./generator/builtin/kysely-type";
import { createSeedGenerator, SeedGeneratorID } from "./generator/builtin/seed";
import type { AppConfig } from "@/parser/app-config";
import "./mock";

// Register built-in generators with their constructor functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const builtinGenerators = new Map<string, (options: any) => CodeGeneratorBase>([
  [KyselyGeneratorID, (options: { distPath: string }) => new KyselyGenerator(options)],
  [SeedGeneratorID, (options: { distPath: string }) => createSeedGenerator(options)],
  [
    EnumConstantsGeneratorID,
    (options: { distPath: string }) => new EnumConstantsGenerator(options),
  ],
  [FileUtilsGeneratorID, (options: { distPath: string }) => new FileUtilsGenerator(options)],
]);

export const GeneratorConfigSchema = createGeneratorConfigSchema(builtinGenerators);

/**
 * Load Tailor configuration file and associated generators.
 * @param configPath - Optional explicit config path
 * @returns Loaded config and generators
 */
export async function loadConfig(
  configPath?: string,
): Promise<{ config: AppConfig; generators: Generator[]; configPath: string }> {
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
  for (const value of Object.values(configModule)) {
    if (Array.isArray(value)) {
      const parsed = value.reduce(
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
      allGenerators.push(...parsed.items);
    }
  }

  return {
    config: configModule.default as AppConfig,
    generators: allGenerators,
    configPath: resolvedPath,
  };
}

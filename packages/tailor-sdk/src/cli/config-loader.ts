import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "@/configure/config";
import {
  KyselyGenerator,
  KyselyGeneratorID,
} from "./generator/builtin/kysely-type";
import {
  DbTypeGenerator,
  DbTypeGeneratorID,
} from "./generator/builtin/db-type";
import {
  createGeneratorConfigSchema,
  type CodeGeneratorBase,
  type Generator,
} from "@/parser/generator-config";
import "./mock";

// Register built-in generators with their constructor functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const builtinGenerators = new Map<string, (options: any) => CodeGeneratorBase>([
  [
    KyselyGeneratorID,
    (options: { distPath: string }) => new KyselyGenerator(options),
  ],
  [
    DbTypeGeneratorID,
    (options: {
      distPath: string | ((context: { tailorDB: string }) => string);
    }) => new DbTypeGenerator(options),
  ],
]);

export const GeneratorConfigSchema =
  createGeneratorConfigSchema(builtinGenerators);

export async function loadConfig(
  configPath: string,
): Promise<{ config: AppConfig; generators: Generator[] }> {
  const resolvedPath = path.resolve(process.cwd(), configPath);

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
  };
}

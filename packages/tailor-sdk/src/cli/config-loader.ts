import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { AppConfig } from "@/configure/config";
import type { CodeGenerator } from "@/configure/generator/types";
import {
  KyselyGenerator,
  KyselyGeneratorID,
} from "./generator/builtin/kysely-type";
import {
  DbTypeGenerator,
  DbTypeGeneratorID,
} from "./generator/builtin/db-type";

const DistPathOptionSchema = z.object({
  distPath: z.union([
    z.string(),
    z.function({
      input: [
        z.object({
          tailorDB: z.string(),
        }),
      ],
      output: z.string(),
    }),
  ]),
});

// FIXME: more strict schema validation
const CodeGeneratorSchema = z.object({
  id: z.string(),
  description: z.string(),
  processType: z.function(),
  processResolver: z.function(),
  processExecutor: z.function(),
  processTailorDBNamespace: z.function(),
  processPipelineNamespace: z.function(),
  aggregate: z.function({ output: z.any() }),
}) satisfies z.ZodType<CodeGenerator>;

export const GeneratorConfigSchema = z
  .union([
    z.tuple([z.literal(KyselyGeneratorID), DistPathOptionSchema]),
    z.tuple([z.literal(DbTypeGeneratorID), DistPathOptionSchema]),
    CodeGeneratorSchema,
  ])
  .transform((gen) => {
    if (Array.isArray(gen)) {
      if (gen[0] === KyselyGeneratorID) {
        return new KyselyGenerator(gen[1]);
      }
      if (gen[0] === DbTypeGeneratorID) {
        return new DbTypeGenerator(gen[1]);
      }
      throw new Error(`Unknown generator ID: ${gen[0]}`);
    }
    return gen;
  })
  .brand("CodeGenerator");
export type Generator = z.infer<typeof GeneratorConfigSchema>;

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

import { z } from "zod";
import type { CodeGeneratorBase } from "./types";

// Literal-based schemas for each generator
export const KyselyTypeConfigSchema = z.tuple([
  z.literal("@tailor/kysely-type"),
  z.object({ distPath: z.string() }),
]);

export const DbTypeConfigSchema = z.tuple([
  z.literal("@tailor/db-type"),
  z.object({
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
  }),
]);

// FIXME: more strict schema validation
export const CodeGeneratorSchema = z.object({
  id: z.string(),
  description: z.string(),
  processType: z.function(),
  processResolver: z.function(),
  processExecutor: z.function(),
  processTailorDBNamespace: z.function().optional(),
  processResolverNamespace: z.function().optional(),
  aggregate: z.function({ output: z.any() }),
});

// Base schema for generator config (before transformation to actual Generator instances)
export const BaseGeneratorConfigSchema = z.union([
  KyselyTypeConfigSchema,
  DbTypeConfigSchema,
  CodeGeneratorSchema,
]);

export type * from "./types";

/**
 * Creates a GeneratorConfigSchema with built-in generator support
 * @param builtinGenerators - Map of generator IDs to their constructor functions
 */
export function createGeneratorConfigSchema(
  builtinGenerators: Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options: any) => CodeGeneratorBase
  >,
) {
  return z
    .union([KyselyTypeConfigSchema, DbTypeConfigSchema, CodeGeneratorSchema])
    .transform((gen) => {
      if (Array.isArray(gen)) {
        const [id, options] = gen;
        const constructor = builtinGenerators.get(id);
        if (constructor) {
          return constructor(options);
        }
        throw new Error(`Unknown generator ID: ${id}`);
      }
      return gen as CodeGeneratorBase;
    })
    .brand("CodeGenerator");
}

export type GeneratorConfigSchemaType = ReturnType<
  typeof createGeneratorConfigSchema
>;
export type Generator = z.output<GeneratorConfigSchemaType>;

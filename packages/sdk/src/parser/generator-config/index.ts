import { z } from "zod";
import type { CodeGeneratorBase } from "./types";

// Dependency kind enum for generators
const DependencyKindSchema = z.enum(["tailordb", "resolver", "executor"]);
export type DependencyKind = z.infer<typeof DependencyKindSchema>;

// Literal-based schemas for each generator
const KyselyTypeConfigSchema = z.tuple([
  z.literal("@tailor-platform/kysely-type"),
  z.object({ distPath: z.string() }),
]);

const SeedConfigSchema = z.tuple([
  z.literal("@tailor-platform/seed"),
  z.object({ distPath: z.string(), machineUserName: z.string().optional() }),
]);

const EnumConstantsConfigSchema = z.tuple([
  z.literal("@tailor-platform/enum-constants"),
  z.object({ distPath: z.string() }),
]);

const FileUtilsConfigSchema = z.tuple([
  z.literal("@tailor-platform/file-utils"),
  z.object({ distPath: z.string() }),
]);

// Custom generator schema with dependencies
export const CodeGeneratorSchema = z.object({
  id: z.string(),
  description: z.string(),
  dependencies: z.array(DependencyKindSchema),
  processType: z.function().optional(),
  processResolver: z.function().optional(),
  processExecutor: z.function().optional(),
  processTailorDBNamespace: z.function().optional(),
  processResolverNamespace: z.function().optional(),
  aggregate: z.function({ output: z.any() }),
});

// Base schema for generator config (before transformation to actual Generator instances)
export const BaseGeneratorConfigSchema = z.union([
  KyselyTypeConfigSchema,
  SeedConfigSchema,
  EnumConstantsConfigSchema,
  FileUtilsConfigSchema,
  CodeGeneratorSchema,
]);

export type * from "./types";

/**
 * Creates a GeneratorConfigSchema with built-in generator support
 * @param builtinGenerators - Map of generator IDs to their constructor functions
 * @returns Generator config schema
 */
export function createGeneratorConfigSchema(
  builtinGenerators: Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options: any) => CodeGeneratorBase
  >,
) {
  return z
    .union([
      KyselyTypeConfigSchema,
      SeedConfigSchema,
      EnumConstantsConfigSchema,
      FileUtilsConfigSchema,
      CodeGeneratorSchema,
    ])
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

export type GeneratorConfigSchemaType = ReturnType<typeof createGeneratorConfigSchema>;
export type Generator = z.output<GeneratorConfigSchemaType>;

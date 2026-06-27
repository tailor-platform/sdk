import { z } from "zod";

// Dependency kind enum for generators
const DependencyKindSchema = z.enum(["tailordb", "resolver", "executor"]);
export type DependencyKind = z.infer<typeof DependencyKindSchema>;

// Literal-based schemas for each generator
const KyselyTypeConfigSchema = z.tuple([
  z.literal("@tailor-platform/kysely-type"),
  z.strictObject({ distPath: z.string() }),
]);

const SeedConfigSchema = z.tuple([
  z.literal("@tailor-platform/seed"),
  z.strictObject({
    distPath: z.string(),
    machineUserName: z.string().optional(),
    disableIdpUserSync: z
      .strictObject({
        userToIdp: z.boolean().optional(),
        idpToUser: z.boolean().optional(),
      })
      .optional(),
  }),
]);

const EnumConstantsConfigSchema = z.tuple([
  z.literal("@tailor-platform/enum-constants"),
  z.strictObject({ distPath: z.string() }),
]);

const FileUtilsConfigSchema = z.tuple([
  z.literal("@tailor-platform/file-utils"),
  z.strictObject({ distPath: z.string() }),
]);

// Custom generator schema with dependencies
// strip unknown keys
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

import type { BaseGeneratorConfigSchema, CodeGeneratorSchema } from "@/parser/generator-config";
import type { z } from "zod";

export type DependencyKind = "tailordb" | "resolver" | "executor";

export type GeneratorConfig = z.input<typeof BaseGeneratorConfigSchema>;

export type CodeGeneratorBase = Omit<z.output<typeof CodeGeneratorSchema>, "dependencies"> & {
  dependencies: readonly DependencyKind[];
};

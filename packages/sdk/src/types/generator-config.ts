import type { BaseGeneratorConfigInput, CodeGeneratorInput } from "./generator-config.generated";

export type DependencyKind = "tailordb" | "resolver" | "executor";

export type GeneratorConfig = BaseGeneratorConfigInput;

export type CodeGeneratorBase = Omit<CodeGeneratorInput, "dependencies"> & {
  dependencies: readonly DependencyKind[];
};

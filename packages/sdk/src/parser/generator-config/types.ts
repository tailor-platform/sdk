import type {
  BaseGeneratorConfigSchema,
  CodeGeneratorSchema,
  DependencyKind,
} from "./index";
import type { z } from "zod";

export type GeneratorConfig = z.input<typeof BaseGeneratorConfigSchema>;

// Manual type definition to support readonly dependencies array
export type CodeGeneratorBase = Omit<
  z.output<typeof CodeGeneratorSchema>,
  "dependencies"
> & {
  dependencies: readonly DependencyKind[];
};

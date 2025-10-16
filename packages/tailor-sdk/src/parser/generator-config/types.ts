import type { z } from "zod";
import type {
  BaseGeneratorConfigSchema,
  CodeGeneratorSchema,
  DistPathOptionSchema,
} from "./index";

export type DistPathOption = z.infer<typeof DistPathOptionSchema>;
export type GeneratorConfig = z.input<typeof BaseGeneratorConfigSchema>;
export type CodeGeneratorBase = z.infer<typeof CodeGeneratorSchema>;

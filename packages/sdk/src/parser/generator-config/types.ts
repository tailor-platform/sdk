import type { BaseGeneratorConfigSchema, CodeGeneratorSchema } from "./index";
import type { z } from "zod";

export type GeneratorConfig = z.input<typeof BaseGeneratorConfigSchema>;
export type CodeGeneratorBase = z.output<typeof CodeGeneratorSchema>;

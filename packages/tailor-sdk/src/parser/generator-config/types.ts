import type { z } from "zod";
import type { BaseGeneratorConfigSchema, CodeGeneratorSchema } from "./index";

export type GeneratorConfig = z.input<typeof BaseGeneratorConfigSchema>;
export type CodeGeneratorBase = z.output<typeof CodeGeneratorSchema>;

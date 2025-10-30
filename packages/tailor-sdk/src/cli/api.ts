// CLI API exports for programmatic usage
export { apply } from "./apply/index";
export type { ApplyOptions } from "./apply/index";
export { generate } from "./generator/index";
export type { GenerateOptions } from "./generator/options";
export { loadConfig } from "./config-loader";
export { generateUserTypes } from "./type-generator";
export type {
  CodeGenerator,
  GeneratorInput,
  GeneratorResult,
} from "./generator/types";
export type { ParsedTailorDBType as TailorDBType } from "@/parser/service/tailordb/types";
export type { Resolver } from "@/parser/service/pipeline/index";
export type { Executor } from "@/configure/services/executor/types";

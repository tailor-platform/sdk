/* eslint-disable @typescript-eslint/no-explicit-any */
import { Resolver } from "../services/pipeline/resolver";
import { TailorDBType } from "../services/tailordb/schema";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratorMetadata<T, R> {
  types: Record<string, T>;
  resolvers: Record<string, R>;
}

export interface GeneratorResult {
  files: GeneratedFile[];
  errors?: string[];
}

export interface SeparatedCodeGenerator {
  readonly id: string;
  readonly description: string;

  processType(
    type: TailorDBType,
  ): GeneratedFile | Promise<GeneratedFile> | null | Promise<null>;
  processResolver(
    type: Resolver,
  ): GeneratedFile | Promise<GeneratedFile> | null | Promise<null>;
}

export interface AggregateCodeGenerator<T = any, R = any> {
  readonly id: string;
  readonly description: string;

  processType(type: TailorDBType): Promise<T>;
  processResolver(type: Resolver): Promise<R>;
  aggregate(
    metadata: GeneratorMetadata<T, R>,
    baseDir: string,
  ): GeneratorResult;
}

export type CodeGenerator<T, R> =
  | SeparatedCodeGenerator
  | AggregateCodeGenerator<T, R>;

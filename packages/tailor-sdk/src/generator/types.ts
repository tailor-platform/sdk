/* eslint-disable @typescript-eslint/no-explicit-any */
import { Resolver } from "../services/pipeline/resolver";
import { TailorDBType } from "../services/tailordb/schema";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface BasicGeneratorMetadata<T, R> {
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

export interface AggregateCodeGenerator<
  T = any,
  R = any,
  Ts = Record<string, T>,
  Rs = Record<string, R>,
> {
  readonly id: string;
  readonly description: string;

  processType(type: TailorDBType): T | Promise<T>;
  processTypes?(types: Record<string, T>): Ts | Promise<Ts>;
  processResolver(resolver: Resolver): R | Promise<R>;
  processResolvers?(resolvers: Record<string, R>): Rs | Promise<Rs>;
  aggregate(
    metadata: {
      types: Ts;
      resolvers: Rs;
    },
    baseDir: string,
  ): GeneratorResult;
}

export type CodeGenerator<T, R> =
  | SeparatedCodeGenerator
  | AggregateCodeGenerator<T, R>;

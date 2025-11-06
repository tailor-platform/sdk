import { type Executor } from "@/parser/service/executor";
import { type Resolver } from "@/parser/service/resolver";
import type { CodeGeneratorBase } from "@/parser/generator-config";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

interface GeneratedFile {
  path: string;
  content: string;
  skipIfExists?: boolean; // default: false
}

export interface GeneratorResult {
  files: GeneratedFile[];
  errors?: string[];
}

// Namespace results for TailorDB
export interface TailorDBNamespaceResult<T> {
  namespace: string;
  types: T;
}

// Namespace results for Resolver
export interface ResolverNamespaceResult<R> {
  namespace: string;
  resolvers: R;
}

// Generator input for each application
export interface GeneratorInput<T, R> {
  applicationNamespace: string;
  tailordb: TailorDBNamespaceResult<T>[];
  resolver: ResolverNamespaceResult<R>[];
}

// CodeGenerator interface implements the base type from parser
export interface CodeGenerator<T = any, R = any, E = any, Ts = any, Rs = any>
  extends Omit<
    CodeGeneratorBase,
    "processType" | "processResolver" | "processExecutor" | "aggregate"
  > {
  // Individual processing (receives application, service type, and namespace information)
  processType(args: {
    type: ParsedTailorDBType;
    applicationNamespace: string;
    namespace: string;
  }): T | Promise<T>;

  processResolver(args: {
    resolver: Resolver;
    applicationNamespace: string;
    namespace: string;
  }): R | Promise<R>;

  processExecutor(executor: Executor): E | Promise<E>;

  // Aggregation processing per namespace (optional, per service type)
  processTailorDBNamespace?(args: {
    applicationNamespace: string;
    namespace: string;
    types: Record<string, T>;
  }): Ts | Promise<Ts>;

  processResolverNamespace?(args: {
    applicationNamespace: string;
    namespace: string;
    resolvers: Record<string, R>;
  }): Rs | Promise<Rs>;

  // Final aggregation processing - receives result array for each application
  aggregate(args: {
    inputs: GeneratorInput<Ts, Rs>[];
    executorInputs: E[];
    baseDir: string;
  }): GeneratorResult | Promise<GeneratorResult>;
}

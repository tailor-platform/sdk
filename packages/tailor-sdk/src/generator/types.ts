import { type Executor } from "@/services/executor/types";
import { type Resolver } from "../services/pipeline/resolver";
import { type TailorDBType } from "../services/tailordb/schema";

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

// Namespace results for Pipeline
export interface PipelineNamespaceResult<R> {
  namespace: string;
  resolvers: R;
}

// Generator input for each application
export interface GeneratorInput<T, R> {
  applicationNamespace: string;
  tailordb: TailorDBNamespaceResult<T>[];
  pipeline: PipelineNamespaceResult<R>[];
}

export interface CodeGenerator<T = any, R = any, E = any, Ts = any, Rs = any> {
  readonly id: string;
  readonly description: string;

  // Individual processing (receives application, service type, and namespace information)
  processType(args: {
    type: TailorDBType;
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

  processPipelineNamespace?(args: {
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

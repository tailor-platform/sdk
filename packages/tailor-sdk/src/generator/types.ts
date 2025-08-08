/* eslint-disable @typescript-eslint/no-explicit-any */
import { Executor } from "@/services/executor/types";
import { Resolver } from "../services/pipeline/resolver";
import { TailorDBType } from "../services/tailordb/schema";

interface GeneratedFile {
  path: string;
  content: string;
  skipIfExists?: boolean; // default: false
}

export interface BasicGeneratorMetadata<T = any, R = any, E = any> {
  types: Record<string, T>;
  resolvers: Record<string, R>;
  executors: E[];
}

export interface GeneratorResult {
  files: GeneratedFile[];
  errors?: string[];
}

// TailorDB用のnamespace結果
export interface TailorDBNamespaceResult<T> {
  namespace: string;
  types: T;
}

// Pipeline用のnamespace結果
export interface PipelineNamespaceResult<R> {
  namespace: string;
  resolvers: R;
}

// application毎のgenerator入力
export interface GeneratorInput<T, R> {
  applicationNamespace: string;
  tailordb: TailorDBNamespaceResult<T>[];
  pipeline: PipelineNamespaceResult<R>[];
}

export interface CodeGenerator<T = any, R = any, E = any, Ts = any, Rs = any> {
  readonly id: string;
  readonly description: string;

  // 個別処理（application、service種別、namespace情報を受け取る）
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

  // namespace毎のまとめ処理（オプション、service種別毎）
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

  // 最終統合処理 - application毎の結果配列を受け取る
  aggregate(args: {
    inputs: GeneratorInput<Ts, Rs>[];
    executorInputs: E[];
    baseDir: string;
  }): GeneratorResult | Promise<GeneratorResult>;
}

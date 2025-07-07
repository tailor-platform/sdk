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

// service種別とnamespace情報を含むコンテキスト
export interface ServiceNamespaceContext<T = any, R = any> {
  applicationNamespace: string;
  serviceType: "tailordb" | "pipeline";
  namespace: string;
  data: T | R;
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

export interface CodeGenerator<T = any, R = any, Ts = any, Rs = any> {
  readonly id: string;
  readonly description: string;

  // 個別処理（application、service種別、namespace情報を受け取る）
  processType(
    type: TailorDBType,
    applicationNamespace: string,
    namespace: string,
  ): T | Promise<T>;

  processResolver(
    resolver: Resolver,
    applicationNamespace: string,
    namespace: string,
  ): R | Promise<R>;

  // namespace毎のまとめ処理（オプション、service種別毎）
  processTailorDBNamespace?(
    applicationNamespace: string,
    namespace: string,
    types: Record<string, T>,
  ): Ts | Promise<Ts>;

  processPipelineNamespace?(
    applicationNamespace: string,
    namespace: string,
    resolvers: Record<string, R>,
  ): Rs | Promise<Rs>;

  // 最終統合処理 - application毎の結果配列を受け取る
  aggregate(
    inputs: GeneratorInput<Ts, Rs>[],
    baseDir: string,
  ): GeneratorResult | Promise<GeneratorResult>;
}

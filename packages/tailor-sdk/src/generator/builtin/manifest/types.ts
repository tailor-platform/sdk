import { PipelineResolver_OperationType } from "@tailor-inc/operator-client";

/**
 * Manifest生成専用の型定義
 * SDL生成とは完全に独立
 */

export interface ManifestTypeMetadata {
  name: string;
  fields: ManifestFieldMetadata[];
  isInput: boolean;
}

export interface ManifestFieldMetadata {
  name: string;
  description?: string;
  type: string;
  required: boolean;
  array: boolean;
}

// Pipeline Manifest生成用の型定義
export interface ManifestJSON {
  Kind: string;
  Description: string;
  Namespace: string;
  Resolvers: ResolverManifest[];
  Version: string;
}

export interface ResolverManifest {
  Authorization: string;
  Description: string;
  Inputs: ManifestInput[];
  Name: string;
  Response: ManifestResponse;
  Pipelines: PipelineManifest[];
  PostHook: { Expr: string };
  PublishExecutionEvents: boolean;
}

export interface ManifestInput {
  Name: string;
  Description: string;
  Array: boolean;
  Required: boolean;
  Type: ManifestType;
}

export interface ManifestResponse {
  Type: ManifestType;
  Description: string;
  Array: boolean;
  Required: boolean;
}

export interface ManifestType {
  Kind: string;
  Name: string;
  Description: string;
  Required: boolean;
  Fields?: ManifestField[];
}

export interface ManifestField {
  Name: string;
  Description: string;
  Type: ManifestType;
  Array: boolean;
  Required: boolean;
}

export interface PipelineManifest {
  Name: string;
  OperationName: string;
  Description: string;
  OperationType: PipelineResolver_OperationType;
  OperationSource?: string;
  OperationSourcePath?: string;
  OperationHook: { Expr: string };
  PostScript: string;
}

// Resolver処理用のメタデータ
export interface ResolverManifestMetadata {
  name: string;
  inputType: string;
  outputType: string;
  queryType: "query" | "mutation";
  pipelines: PipelineInfo[];
  outputMapper?: string; // 関数の文字列表現
  inputFields?: Record<
    string,
    { type: string; required: boolean; array: boolean }
  >;
  outputFields?: Record<
    string,
    { type: string; required: boolean; array: boolean }
  >;
}

export interface PipelineInfo {
  name: string;
  description: string;
  operationType: PipelineResolver_OperationType;
  operationSource?: string;
}

// ワークスペース全体のManifest型
export interface WorkspaceManifest {
  Apps: AppManifest[];
  Kind: string;
  Services: ServiceManifest[];
  Auths: AuthManifest[];
  Pipelines: ManifestJSON[];
  Executors: ExecutorManifest[];
  Stateflows: StateflowManifest[];
  Tailordbs: TailordbManifest[];
}

// 各種Manifest型の定義
export interface AppManifest {
  Name: string;
  [key: string]: unknown;
}

export interface ServiceManifest {
  Kind: string;
  Namespace: string;
  [key: string]: unknown;
}

export interface AuthManifest {
  Kind: string;
  Namespace: string;
  [key: string]: unknown;
}

export interface ExecutorManifest {
  Kind: string;
  Namespace: string;
  [key: string]: unknown;
}

export interface StateflowManifest {
  Kind: string;
  Namespace: string;
  [key: string]: unknown;
}

export interface TailordbManifest {
  Kind: string;
  Namespace: string;
  [key: string]: unknown;
}

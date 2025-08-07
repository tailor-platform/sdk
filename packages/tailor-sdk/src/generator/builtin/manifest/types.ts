import { OperationType } from "@/types/operator";

/**
 * Manifest生成専用の型定義
 * SDL生成とは完全に独立
 */

export interface ManifestTypeMetadata {
  name: string;
  fields: ManifestFieldMetadata[];
  isInput: boolean;
  typeManifest?: any;
}

export interface ManifestFieldMetadata {
  name: string;
  description?: string;
  type: string;
  required: boolean;
  array: boolean;
}

// ワークスペース全体のManifest型
export interface WorkspaceManifest {
  Apps: AppManifest[];
  Kind: string;
  Auths: AuthManifest[];
  Pipelines: PipelineManifest[];
  IdPs: IdPManifest[];
  Executors: ExecutorManifest[];
  Stateflows: StateflowManifest[];
  Tailordbs: TailordbManifest[];
}

// 各種Manifest型の定義
interface AppManifest {
  Name: string;
  [key: string]: unknown;
}

interface ServiceManifest {
  Kind: string;
  [key: string]: unknown;
}

export interface AuthManifest extends ServiceManifest {
  Kind: "auth";
  Namespace: string;
  [key: string]: unknown;
}

export interface IdPManifest extends ServiceManifest {
  Kind: "idp";
  Namespace: string;
  Authorization: "true==true" | "user != null && size(user.id) > 0"; // FIXME: string
  Clients: { Name: string }[];
}

export interface ExecutorManifest extends ServiceManifest {
  Kind: "executor";
  Executors: Array<{
    Name: string;
    Description?: string;
    Trigger: any;
    TriggerSchedule?: any;
    TriggerEvent?: any;
    TriggerIncomingWebhook?: any;
    Target: any;
    TargetWebhook?: any;
    TargetTailorGraphql?: any;
    TargetFunction?: any;
  }>;
  Version: string;
}

interface StateflowManifest extends ServiceManifest {
  Kind: "stateflow";
  Namespace: string;
  [key: string]: unknown;
}

export interface TailordbManifest extends ServiceManifest {
  Kind: "tailordb";
  Namespace: string;
  [key: string]: unknown;
}

// Pipeline Manifest生成用の型定義
export interface PipelineManifest extends ServiceManifest {
  Kind: "pipeline";
  Description: string;
  Namespace: string;
  Resolvers: ResolverManifest[];
  Version: string;
}

interface ResolverManifest {
  Authorization: string;
  Description: string;
  Inputs: ResolverInput[];
  Name: string;
  Response: ResolverResponse;
  Pipelines: PipelineItemManifest[];
  PostHook: { Expr: string };
  PublishExecutionEvents: boolean;
}

interface ResolverInput {
  Name: string;
  Description: string;
  Array: boolean;
  Required: boolean;
  Type: TailorType;
}

interface ResolverResponse {
  Type: TailorType;
  Description: string;
  Array: boolean;
  Required: boolean;
}

interface TailorType {
  Kind: string;
  Name: string;
  Description: string;
  Required: boolean;
  Fields?: TypeField[];
}

interface TypeField {
  Name: string;
  Description: string;
  Type: TailorType;
  Array: boolean;
  Required: boolean;
}

interface PipelineItemManifest {
  Name: string;
  OperationName: string;
  Description: string;
  OperationType: OperationType;
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
  resolverManifest?: any; // 生成されたResolverManifest
}

export interface PipelineInfo {
  name: string;
  description: string;
  operationType: OperationType;
  operationSource?: string;
}

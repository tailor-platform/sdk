import { OperationType } from "@/types/operator";

// TailorDB Type Manifest定義
export interface TailorDBTypeManifest {
  Name: string;
  Description: string;
  Fields: Record<string, TailorDBFieldManifest>;
  Relationships: Record<string, TailorDBRelationshipManifest>;
  Settings: TailorDBTypeSettings;
  Extends: boolean;
  Directives: any[];
  Indexes: Record<string, TailorDBIndexManifest>;
  Permission?: TailorDBPermissionManifest;
  TypePermission?: TailorDBTypePermissionManifest;
}

export interface TailorDBFieldManifest {
  Type: string;
  AllowedValues: string[];
  Description: string;
  Validate: TailorDBValidationRule[];
  Array: boolean;
  Index: boolean;
  Unique: boolean;
  ForeignKey: boolean;
  ForeignKeyType?: string;
  Required: boolean;
  Vector?: boolean;
  Hooks?: {
    Create?: { Expr: string };
    Update?: { Expr: string };
  };
  Serial?: {
    Start: number;
    MaxValue?: number;
    Format?: string;
  };
  Fields?: Record<string, TailorDBFieldManifest>; // For nested fields
}

export interface TailorDBValidationRule {
  Action: "deny";
  ErrorMessage: string;
  Expr: string;
  Script?: {
    Expr: string;
  };
}

export interface TailorDBRelationshipManifest {
  RefType: string;
  RefField: string;
  SrcField: string;
  Array: boolean;
  Description: string;
}

export interface TailorDBTypeSettings {
  Aggregation: boolean;
  BulkUpsert: boolean;
  Draft: boolean;
  DefaultQueryLimitSize: number;
  MaxBulkUpsertSize: number;
  PluralForm: string;
  PublishRecordEvents: boolean;
}

export interface TailorDBIndexManifest {
  FieldNames: string[];
  Unique: boolean;
}

export interface TailorDBPermissionManifest {
  [operation: string]: any; // Based on the permission structure
}

export interface TailorDBTypePermissionManifest {
  Create: TailorDBPermissionEntry[];
  Read: TailorDBPermissionEntry[];
  Update: TailorDBPermissionEntry[];
  Delete: TailorDBPermissionEntry[];
  Admin: TailorDBPermissionEntry[];
}

export interface TailorDBPermissionEntry {
  Id: string;
  Ids: string[];
  Permit: "allow" | "deny";
}

export interface ManifestTypeMetadata {
  name: string;
  isInput: boolean;
  typeManifest: TailorDBTypeManifest;
  gqlPermissionManifest?: GQLPermissionManifest;
}

export interface ManifestFieldMetadata {
  name: string;
  description?: string;
  type: string;
  required: boolean;
  array: boolean;
}

export interface GQLPermissionManifest {
  Type: string;
  Policies: GQLPermissionPolicyManifest[];
}

export interface GQLPermissionPolicyManifest {
  Conditions?: GQLPermissionConditionManifest[];
  Actions: string[];
  Permit: "allow" | "deny";
  Description?: string;
}

export interface GQLPermissionConditionManifest {
  LeftUser?: GQLPermissionOperandManifest;
  LeftValue?: GQLPermissionOperandManifest;
  Operator: "eq" | "ne" | "in" | "nin";
  RightUser?: GQLPermissionOperandManifest;
  RightValue?: GQLPermissionOperandManifest;
}

export interface GQLPermissionOperandManifest {
  Kind: "user" | "value";
  Value: string | boolean | number | string[];
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
  Types?: TailorDBTypeManifest[];
  GQLPermissions?: GQLPermissionManifest[];
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

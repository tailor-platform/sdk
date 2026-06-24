import type { ValueOperand } from "#/configure/services/auth/types";
// TailorDB parsed data structures (normalized form shared by parser, CLI,
// and plugin layers). Produced by CLI-side parsing (TailorDBService.loadTypes),
// not by Zod schemas, so these cannot be zinfer-generated.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { RawRelationConfig, TailorDBTypeMetadata } from "#/configure/services/tailordb/types";
import type { EnumValue } from "#/configure/types/field.types";
import type {
  DBFieldMetadata as DBFieldMetadataGenerated,
  RawRelationConfig as RawRelationConfigGenerated,
  TailorDBTypeParsedSettings,
} from "#/types/tailordb.generated";

export type TailorDBFieldOutput = {
  type: string;
  fields?: Record<string, TailorDBFieldOutput>;
  metadata: DBFieldMetadataGenerated;
  rawRelation?: RawRelationConfigGenerated;
};

export type TypeSourceInfo = Record<string, TypeSourceInfoEntry>;

// Source info types
export interface UserDefinedTypeSource {
  filePath: string;
  exportName: string;
  pluginId?: never;
}

export interface PluginGeneratedTypeSource {
  filePath?: never;
  exportName: string;
  pluginId: string;
  pluginImportPath: string;
  originalFilePath: string;
  originalExportName: string;
  generatedTypeKind?: string;
  pluginConfig?: unknown;
  namespace?: string;
}

export type TypeSourceInfoEntry = UserDefinedTypeSource | PluginGeneratedTypeSource;

// Operator field types
export interface Script {
  expr: string;
}

interface OperatorValidateConfig {
  script: Script;
  errorMessage: string;
}

interface OperatorFieldHook {
  create?: Script;
  update?: Script;
}

export interface OperatorFieldConfig {
  type: string;
  required?: boolean;
  description?: string;
  allowedValues?: EnumValue[];
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  rawRelation?: RawRelationConfig;
  validate?: OperatorValidateConfig[];
  hooks?: OperatorFieldHook;
  serial?: {
    start: number;
    maxValue?: number;
    format?: string;
  };
  scale?: number;
  fields?: Record<string, OperatorFieldConfig>;
}

// Permission types (parsed/standard format)
type GqlPermissionAction = "read" | "create" | "update" | "delete" | "aggregate" | "bulkUpsert";

type StandardPermissionOperator = "eq" | "ne" | "in" | "nin" | "hasAny" | "nhasAny";

type UserOperand = {
  user: string;
};

type StandardRecordOperand<Update extends boolean = false> = Update extends true
  ? { oldRecord: string } | { newRecord: string }
  : { record: string };

export type PermissionOperand<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
> = UserOperand | ValueOperand | (Level extends "record" ? StandardRecordOperand<Update> : never);

export type StandardPermissionCondition<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
> = readonly [
  PermissionOperand<Level, Update>,
  StandardPermissionOperator,
  PermissionOperand<Level, Update>,
];

export type StandardActionPermission<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
> = {
  conditions: readonly StandardPermissionCondition<Level, Update>[];
  description?: string;
  permit: "allow" | "deny";
};

export type StandardTailorTypePermission = {
  create: readonly StandardActionPermission<"record", false>[];
  read: readonly StandardActionPermission<"record", false>[];
  update: readonly StandardActionPermission<"record", true>[];
  delete: readonly StandardActionPermission<"record", false>[];
};

export type StandardGqlPermissionPolicy = {
  conditions: readonly StandardPermissionCondition<"gql">[];
  actions: readonly ["all"] | readonly GqlPermissionAction[];
  permit: "allow" | "deny";
  description?: string;
};

export type StandardTailorTypeGqlPermission = readonly StandardGqlPermissionPolicy[];

export interface Permissions {
  record?: StandardTailorTypePermission;
  gql?: StandardTailorTypeGqlPermission;
}

export interface ParsedField {
  name: string;
  config: OperatorFieldConfig;
  relation?: {
    targetType: string;
    forwardName: string;
    backwardName: string;
    key: string;
    unique: boolean;
  };
}

export interface ParsedRelationship {
  name: string;
  targetType: string;
  targetField: string;
  sourceField: string;
  isArray: boolean;
  description: string;
}

export interface TailorDBType {
  name: string;
  pluralForm: string;
  description?: string;
  fields: Record<string, ParsedField>;
  forwardRelationships: Record<string, ParsedRelationship>;
  backwardRelationships: Record<string, ParsedRelationship>;
  settings: TailorDBTypeParsedSettings;
  permissions: Permissions;
  indexes?: TailorDBTypeMetadata["indexes"];
  files?: TailorDBTypeMetadata["files"];
}

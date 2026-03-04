import type { RelationType } from "./relation";
import type {
  DBFieldMetadataSchema,
  RawRelationConfigSchema,
  RawPermissionsSchema,
  TailorDBTypeSchema,
  TailorDBServiceConfig as TailorDBServiceConfigType,
  TailorDBTypeSettingsSchema,
} from "./schema";
import type { GqlOperationsConfig } from "@/configure/services/tailordb";
import type { ValueOperand } from "@/parser/service/auth/types";
import type { z } from "zod";

export type { RelationType } from "./relation";
export type { TypeSourceInfo } from "./type-parser";

// ========================================
// Source info type for TailorDB types
// ========================================

/**
 * Source information for a user-defined TailorDB type.
 */
export interface UserDefinedTypeSource {
  /** File path to import from */
  filePath: string;
  /** Export name in the source file */
  exportName: string;
  /** Not present for user-defined types */
  pluginId?: never;
}

/**
 * Source information for a plugin-generated TailorDB type.
 */
export interface PluginGeneratedTypeSource {
  /** Not present for plugin-generated types */
  filePath?: never;
  /** Export name of the generated type */
  exportName: string;
  /** Plugin ID that generated this type */
  pluginId: string;
  /** Plugin import path for code generators */
  pluginImportPath: string;
  /** Original type's file path */
  originalFilePath: string;
  /** Original type's export name */
  originalExportName: string;
  /** Generated type kind for getGeneratedType() API (e.g., "request", "step") */
  generatedTypeKind?: string;
  /** Plugin config used to generate this type */
  pluginConfig?: unknown;
  /** Namespace where this type was generated */
  namespace?: string;
}

/**
 * Source information for a TailorDB type.
 * Discriminated union: use `pluginId` to distinguish between user-defined and plugin-generated types.
 */
export type TypeSourceInfoEntry = UserDefinedTypeSource | PluginGeneratedTypeSource;

/**
 * Type guard to check if source is plugin-generated
 * @param source - Type source info to check
 * @returns True if source is plugin-generated
 */
export function isPluginGeneratedType(
  source: TypeSourceInfoEntry,
): source is PluginGeneratedTypeSource {
  return source.pluginId !== undefined;
}

export type {
  TailorAnyDBField,
  TailorAnyDBType,
  TailorDBField,
  DBFieldMetadata,
  Hook,
  TailorTypePermission,
  TailorTypeGqlPermission,
  GqlOperationsConfig,
  GqlOperations,
} from "@/configure/services/tailordb";
export type {
  TailorDBServiceConfigInput,
  TailorDBServiceConfig,
  TailorDBExternalConfig,
  TailorDBServiceInput,
} from "./schema";

/**
 * Parsed and normalized settings for TailorDB type.
 * gqlOperations is normalized from alias to object format.
 * @public
 */
export type TailorDBTypeParsedSettings = z.output<typeof TailorDBTypeSettingsSchema>;

/**
 * Migration configuration for TailorDB
 * @public
 */
export type TailorDBMigrationConfig = NonNullable<TailorDBServiceConfigType["migration"]>;

export type TailorDBTypeSchemaOutput = z.output<typeof TailorDBTypeSchema>;

export type DBFieldMetadataOutput = z.output<typeof DBFieldMetadataSchema>;
export type RawRelationConfigOutput = z.output<typeof RawRelationConfigSchema>;

export type RawPermissions = z.output<typeof RawPermissionsSchema>;

export type TailorDBFieldOutput = {
  type: string;
  fields?: Record<string, TailorDBFieldOutput>;
  metadata: DBFieldMetadataOutput;
  rawRelation?: RawRelationConfigOutput;
};

export interface Script {
  expr: string;
}

export interface EnumValue {
  value: string;
  description?: string;
}

interface OperatorValidateConfig {
  script: Script;
  errorMessage: string;
}

interface OperatorFieldHook {
  create?: Script;
  update?: Script;
}

/**
 * Raw relation config stored in configure layer, processed in parser layer.
 * This is the serialized form of RelationConfig from schema.ts where
 * the TailorDBType reference is replaced with the type name string.
 */
export interface RawRelationConfig {
  type: RelationType;
  toward: {
    type: string;
    as?: string;
    key?: string;
  };
  backward?: string;
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

type GqlPermissionAction = "read" | "create" | "update" | "delete" | "aggregate" | "bulkUpsert";

type StandardPermissionOperator = "eq" | "ne" | "in" | "nin" | "hasAny" | "nhasAny";

type UserOperand = {
  user: string;
};

type RecordOperand<Update extends boolean = false> = Update extends true
  ? { oldRecord: string } | { newRecord: string }
  : { record: string };

export type PermissionOperand<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
> = UserOperand | ValueOperand | (Level extends "record" ? RecordOperand<Update> : never);

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

export interface TailorDBTypeMetadata {
  name: string;
  description?: string;
  settings?: {
    pluralForm?: string;
    aggregation?: boolean;
    bulkUpsert?: boolean;
    gqlOperations?: GqlOperationsConfig;
    publishEvents?: boolean;
  };
  permissions: RawPermissions;
  files: Record<string, string>;
  indexes?: Record<
    string,
    {
      fields: string[];
      unique?: boolean;
    }
  >;
}

/**
 * Parsed and normalized TailorDB field information
 */
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

/**
 * Parsed and normalized TailorDB relationship information
 */
export interface ParsedRelationship {
  name: string;
  targetType: string;
  targetField: string;
  sourceField: string;
  isArray: boolean;
  description: string;
}

/**
 * Parsed and normalized TailorDB type information
 */
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

import type { RelationType } from "./relation";
import type { TailorDBTypeSchema } from "./schema";
import type { TailorTypeGqlPermission, TailorTypePermission } from "@/configure/services/tailordb";
import type { ValueOperand } from "@/parser/service/auth/types";
import type { z } from "zod";

export type { RelationType } from "./relation";
export type {
  TailorAnyDBField,
  TailorDBField,
  DBFieldMetadata,
  Hook,
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@/configure/services/tailordb";

export type TailorDBServiceConfig = {
  files: string[];
  ignores?: string[];
  erdSite?: string;
};

export type TailorDBTypeInput = z.input<typeof TailorDBTypeSchema>;

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
  fields?: Record<string, OperatorFieldConfig>;
}

type GqlPermissionAction = "read" | "create" | "update" | "delete" | "aggregate" | "bulkUpsert";

type StandardPermissionOperator = "eq" | "ne" | "in" | "nin";

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

export interface RawPermissions {
  // Raw permissions are user-provided
  // oxlint-disable-next-line no-explicit-any
  record?: TailorTypePermission<any, any>;
  // Raw permissions are user-provided
  // oxlint-disable-next-line no-explicit-any
  gql?: TailorTypeGqlPermission<any, any>;
}

export interface TailorDBTypeMetadata {
  name: string;
  description?: string;
  settings?: {
    pluralForm?: string;
    aggregation?: boolean;
    bulkUpsert?: boolean;
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
export interface ParsedTailorDBType {
  name: string;
  pluralForm: string;
  description?: string;
  fields: Record<string, ParsedField>;
  forwardRelationships: Record<string, ParsedRelationship>;
  backwardRelationships: Record<string, ParsedRelationship>;
  settings: TailorDBTypeMetadata["settings"];
  permissions: Permissions;
  indexes?: TailorDBTypeMetadata["indexes"];
  files?: TailorDBTypeMetadata["files"];
}

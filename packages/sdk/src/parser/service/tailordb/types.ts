import type { RelationType } from "./relation";
import type {
  TailorAnyDBField,
  TailorDBField,
  TailorTypeGqlPermission,
  TailorTypePermission,
} from "@/configure/services/tailordb";
import type { Hooks, IndexDef, TypeFeatures } from "@/configure/services/tailordb/types";
import type { InferredAttributeMap } from "@/configure/types";
import type { InferFieldsOutput, output } from "@/configure/types/helpers";
import type { FieldOptions, FieldOutput, TailorToTs } from "@/configure/types/types";
import type { Validators } from "@/configure/types/validation";
import type { ValueOperand } from "@/parser/service/auth/types";

export type { RelationType } from "./relation";
export type {
  TailorAnyDBField,
  TailorDBField,
  DBFieldMetadata,
  Hook,
  TailorTypePermission,
  TailorTypeGqlPermission,
  TailorDBServiceInput,
} from "@/configure/services/tailordb";

export type TailorDBServiceConfig = {
  files: string[];
  ignores?: string[];
  erdSite?: string;
};

// Helper alias
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBType = TailorDBType<any, any>;

/**
 * TailorDBType interface representing a database type definition with fields, permissions, and settings.
 */
export interface TailorDBType<
  // Default kept loose to avoid forcing callers to supply generics.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> {
  readonly name: string;
  readonly fields: Fields;
  readonly _output: InferFieldsOutput<Fields>;
  _description?: string;

  /** Returns metadata for the type */
  readonly metadata: TailorDBTypeMetadata;

  /**
   * Add hooks for fields
   */
  hooks(hooks: Hooks<Fields>): TailorDBType<Fields, User>;

  /**
   * Add validators for fields
   */
  validate(validators: Validators<Fields>): TailorDBType<Fields, User>;

  /**
   * Configure type features
   */
  features(features: Omit<TypeFeatures, "pluralForm">): TailorDBType<Fields, User>;

  /**
   * Define composite indexes
   */
  indexes(...indexes: IndexDef<TailorDBType<Fields, User>>[]): TailorDBType<Fields, User>;

  /**
   * Define file fields
   */
  files<const F extends string>(
    files: Record<F, string> & Partial<Record<keyof output<TailorDBType<Fields, User>>, never>>,
  ): TailorDBType<Fields, User>;

  /**
   * Set record-level permissions
   */
  permission<
    U extends object = User,
    P extends TailorTypePermission<U, output<TailorDBType<Fields, User>>> = TailorTypePermission<
      U,
      output<TailorDBType<Fields, User>>
    >,
  >(
    permission: P,
  ): TailorDBType<Fields, U>;

  /**
   * Set GraphQL-level permissions
   */
  gqlPermission<
    U extends object = User,
    P extends TailorTypeGqlPermission<U> = TailorTypeGqlPermission<U>,
  >(
    permission: P,
  ): TailorDBType<Fields, U>;

  /**
   * Set type description
   */
  description(description: string): TailorDBType<Fields, User>;

  /**
   * Pick specific fields from the type
   */
  pickFields<K extends keyof Fields, const Opt extends FieldOptions>(
    keys: K[],
    options: Opt,
  ): {
    [P in K]: Fields[P] extends TailorDBField<infer D, infer _O>
      ? TailorDBField<
          Omit<D, "array"> & {
            array: Opt extends { array: true } ? true : D["array"];
          },
          FieldOutput<TailorToTs[D["type"]], Opt>
        >
      : never;
  };

  /**
   * Omit specific fields from the type
   */
  omitFields<K extends keyof Fields>(keys: K[]): Omit<Fields, K>;
}

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

import type { ValueOperand } from "#/configure/services/auth/types";
// TailorDB parsed data structures (normalized form shared by parser, CLI,
// and plugin layers). Produced by CLI-side parsing (TailorDBService.loadTypes),
// not by Zod schemas, so these cannot be zinfer-generated.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { RawRelationConfig, TailorDBTypeMetadata } from "#/configure/services/tailordb/types";
import type { EnumValue } from "#/configure/types/field.types";
import type { TailorDBTypeReplication } from "#/types/tailordb-replication.generated";
import type {
  DBFieldMetadata as DBFieldMetadataGenerated,
  RawRelationConfig as RawRelationConfigGenerated,
  TailorDBTypeParsedSettings,
} from "#/types/tailordb.generated";

export type TailorDBFieldOutput = {
  // Must stay an inline literal union (not an aliased import) — zinfer reads
  // this annotation verbatim into src/types/*.generated.ts, which cannot
  // import from configure.
  type:
    | "uuid"
    | "string"
    | "boolean"
    | "integer"
    | "float"
    | "decimal"
    | "enum"
    | "date"
    | "datetime"
    | "time"
    | "nested";
  fields?: Record<string, TailorDBFieldOutput>;
  metadata: DBFieldMetadataGenerated;
  rawRelation?: RawRelationConfigGenerated | undefined;
};

export type TypeSourceInfo = Record<string, TypeSourceInfoEntry>;

// Source info types
interface UserDefinedTypeSource {
  filePath: string;
  exportName: string;
  pluginId?: never | undefined;
}

export interface PluginGeneratedTableSource {
  filePath?: never | undefined;
  exportName: string;
  pluginId: string;
  pluginImportPath: string;
  originalFilePath: string;
  originalExportName: string;
  generatedTableKind?: string | undefined;
  pluginConfig?: unknown;
  namespace?: string | undefined;
}

export type TypeSourceInfoEntry = UserDefinedTypeSource | PluginGeneratedTableSource;

// Operator field types
interface Script {
  expr: string;
}

interface OperatorValidateConfig {
  script: Script;
  errorMessage: string;
}

interface OperatorFieldHook {
  create?: Script | undefined;
  update?: Script | undefined;
}

export interface OperatorFieldConfig {
  type: string;
  required?: boolean | undefined;
  description?: string | undefined;
  allowedValues?: EnumValue[] | undefined;
  array?: boolean | undefined;
  index?: boolean | undefined;
  unique?: boolean | undefined;
  vector?: boolean | undefined;
  foreignKey?: boolean | undefined;
  foreignKeyType?: string | undefined;
  foreignKeyField?: string | undefined;
  rawRelation?: RawRelationConfig | undefined;
  validate?: OperatorValidateConfig[] | undefined;
  hooks?: OperatorFieldHook | undefined;
  serial?:
    | {
        start: number;
        maxValue?: number | undefined;
        format?: string | undefined;
        gapless?: boolean | undefined;
      }
    | undefined;
  scale?: number | undefined;
  default?: unknown;
  fields?: Record<string, OperatorFieldConfig> | undefined;
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

type PermissionOperand<
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
  description?: string | undefined;
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
  description?: string | undefined;
};

export type StandardTailorTypeGqlPermission = readonly StandardGqlPermissionPolicy[];

export interface Permissions {
  record?: StandardTailorTypePermission | undefined;
  gql?: StandardTailorTypeGqlPermission | undefined;
}

export interface ParsedField {
  name: string;
  config: OperatorFieldConfig;
  relation?:
    | {
        targetType: string;
        forwardName: string;
        backwardName: string;
        key: string;
        unique: boolean;
      }
    | undefined;
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
  description?: string | undefined;
  fields: Record<string, ParsedField>;
  forwardRelationships: Record<string, ParsedRelationship>;
  backwardRelationships: Record<string, ParsedRelationship>;
  settings: TailorDBTypeParsedSettings;
  permissions: Permissions;
  indexes?: TailorDBTypeMetadata["indexes"] | undefined;
  files?: TailorDBTypeMetadata["files"] | undefined;
  typeHookExpr?: { create?: string | undefined; update?: string | undefined } | undefined;
  typeValidateExpr?: string | undefined;
  /** How replications of the namespace copy the table, from `.replication()`. */
  replication?: TailorDBTypeReplication[] | undefined;
}

export type ScriptExprKind =
  | "hooks.create"
  | "hooks.update"
  | "validate"
  | "typeHook.create"
  | "typeHook.update"
  | "typeValidate";

export type PrecompiledScriptExprMap = Partial<Record<ScriptExprKind, string>>;

/**
 * Registry key `./hooks-validate-precompiled-expr.ts` passes to `Symbol.for()`
 * to read a role-keyed script expression map from a hook/validator function.
 * Shared as a type so `configure/services/tailordb/schema.ts` can pin the
 * SDK's own built-in hooks without a runtime import across the configure/parser
 * boundary; a mismatched literal on either side fails to typecheck.
 */
export type PrecompiledScriptExprKey = "tailor-platform/sdk:precompiled-script-expr";

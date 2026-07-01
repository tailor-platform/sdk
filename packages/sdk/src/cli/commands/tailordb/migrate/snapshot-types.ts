/**
 * Schema snapshot data model for TailorDB migrations.
 *
 * Leaf module: these types describe the persisted snapshot format
 * (XXXX/schema.json) and are shared by snapshot.ts (snapshot management)
 * and diff-calculator.ts (diff types and formatting) without creating
 * import cycles between them.
 */

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Hook configuration in schema snapshot
 */
export interface SnapshotHook {
  expr: string;
}

/**
 * Validation configuration in schema snapshot
 */
export interface SnapshotValidation {
  script?: { expr: string };
  errorMessage: string;
}

/**
 * Serial configuration in schema snapshot
 */
export interface SnapshotSerial {
  start: number;
  maxValue?: number;
  format?: string;
}

/**
 * Enum value with optional description in schema snapshot
 */
export interface SnapshotEnumValue {
  value: string;
  description?: string;
}

/**
 * Field configuration in schema snapshot
 */
export interface SnapshotFieldConfig {
  type: string;
  required: boolean;
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  allowedValues?: SnapshotEnumValue[];
  foreignKey?: boolean;
  foreignKeyType?: string;
  foreignKeyField?: string;
  description?: string;
  vector?: boolean;
  hooks?: {
    create?: SnapshotHook;
    update?: SnapshotHook;
  };
  validate?: SnapshotValidation[];
  serial?: SnapshotSerial;
  scale?: number;
  default?: unknown;
  /** Nested fields (recursive) */
  fields?: Record<string, SnapshotFieldConfig>;
}

/**
 * Index configuration in schema snapshot
 */
export interface SnapshotIndexConfig {
  fields: string[];
  unique?: boolean;
}

/**
 * Relationship configuration in schema snapshot
 */
export interface SnapshotRelationship {
  targetType: string;
  targetField: string;
  sourceField: string;
  isArray: boolean;
  description: string;
}

// ============================================================================
// Permission Types
// ============================================================================

/**
 * Field-reference operand in a permission condition. Always an object with
 * exactly one of `user` / `record` / `newRecord` / `oldRecord` keys.
 */
export type SnapshotFieldRefOperand =
  | { user: string }
  | { record: string }
  | { newRecord: string }
  | { oldRecord: string };

/**
 * Literal value operand (right-hand side of a permission condition). Matches
 * the SDK-level value operand surface — primitives and their arrays — as
 * defined in the Zod parser schema (RecordPermissionOperandSchema /
 * GqlPermissionOperandSchema in parser/service/tailordb/schema.ts).
 */
export type SnapshotValueOperand = string | boolean | string[] | boolean[];

/**
 * Permission operand union. Either a field-ref object or a literal value.
 */
export type SnapshotPermissionOperand = SnapshotFieldRefOperand | SnapshotValueOperand;

/**
 * Permission operators
 */
export type SnapshotPermissionOperator = "eq" | "ne" | "in" | "nin" | "hasAny" | "nhasAny";

/**
 * Permission condition tuple
 */
export type SnapshotPermissionCondition = readonly [
  SnapshotPermissionOperand,
  SnapshotPermissionOperator,
  SnapshotPermissionOperand,
];

/**
 * Type guard: is the operand a field-reference (object) operand?
 * @param {SnapshotPermissionOperand} operand - Operand to test
 * @returns {boolean} True if operand is a field-ref (not a value operand)
 */
export function isSnapshotFieldRefOperand(
  operand: SnapshotPermissionOperand,
): operand is SnapshotFieldRefOperand {
  // snapshot JSON may contain null; z.unknown() does not reject it
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return typeof operand === "object" && operand !== null && !Array.isArray(operand);
}

/**
 * Action permission policy
 */
export interface SnapshotActionPermission {
  conditions: readonly SnapshotPermissionCondition[];
  description?: string;
  permit: "allow" | "deny";
}

/**
 * Record-level permission configuration
 */
export interface SnapshotRecordPermission {
  create: readonly SnapshotActionPermission[];
  read: readonly SnapshotActionPermission[];
  update: readonly SnapshotActionPermission[];
  delete: readonly SnapshotActionPermission[];
}

/**
 * GQL permission actions
 */
export type SnapshotGqlAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "aggregate"
  | "bulkUpsert"
  | "all";

/**
 * GQL permission policy
 */
export interface SnapshotGqlPermissionPolicy {
  conditions: readonly SnapshotPermissionCondition[];
  actions: readonly SnapshotGqlAction[];
  permit: "allow" | "deny";
  description?: string;
}

/**
 * GQL permission configuration
 */
export type SnapshotGqlPermission = readonly SnapshotGqlPermissionPolicy[];

/**
 * Type definition in schema snapshot.
 * `pluralForm` is always materialized — either set by the SDK user, derived
 * via inflection at snapshot construction, or backfilled when loading legacy
 * snapshots in `loadSnapshot`.
 */
export interface TailorDBSnapshotType {
  name: string;
  pluralForm: string;
  description?: string;
  fields: Record<string, SnapshotFieldConfig>;
  settings?: {
    aggregation?: boolean;
    bulkUpsert?: boolean;
    gqlOperations?: {
      create?: boolean;
      update?: boolean;
      delete?: boolean;
      read?: boolean;
    };
    publishEvents?: boolean;
  };
  indexes?: Record<string, SnapshotIndexConfig>;
  files?: Record<string, string>;
  forwardRelationships?: Record<string, SnapshotRelationship>;
  backwardRelationships?: Record<string, SnapshotRelationship>;
  permissions?: {
    record?: SnapshotRecordPermission;
    gql?: SnapshotGqlPermission;
  };
  typeValidateExpr?: string;
}

export type SnapshotSettings = NonNullable<TailorDBSnapshotType["settings"]>;
export type SnapshotGqlOperations = NonNullable<SnapshotSettings["gqlOperations"]>;

/**
 * Schema snapshot - full schema state at a point in time.
 * Stored as XXXX/schema.json. Defined here (leaf module) so that
 * snapshot-schema.ts can reference it without importing snapshot.ts.
 */
export interface SchemaSnapshot {
  /** Format version for future compatibility */
  version: number;
  namespace: string;
  createdAt: string;
  types: Record<string, TailorDBSnapshotType>;
}

declare const normalizedSchemaSnapshotBrand: unique symbol;

/**
 * Schema snapshot normalized to a canonical form for consistent comparison.
 *
 * Returned by snapshot creation and loading functions so drift detection stays
 * stable when local definitions omit defaults that the platform materializes.
 */
export type NormalizedSchemaSnapshot = SchemaSnapshot & {
  readonly [normalizedSchemaSnapshotBrand]: true;
};

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
  script?: { expr: string } | undefined;
  errorMessage: string;
}

/**
 * Serial configuration in schema snapshot
 */
export interface SnapshotSerial {
  start: number;
  maxValue?: number | undefined;
  format?: string | undefined;
  gapless?: boolean | undefined;
}

/**
 * Enum value with optional description in schema snapshot
 */
export interface SnapshotEnumValue {
  value: string;
  description?: string | undefined;
}

/**
 * Optional boolean properties of {@link SnapshotFieldConfig}, absent meaning
 * `false`. Every comparator over snapshot fields iterates this single list so
 * a newly added property cannot be silently skipped by one of them; a
 * comparator that ignores some of these must declare its exclusions
 * explicitly.
 */
export const SNAPSHOT_FIELD_BOOLEAN_PROPS = [
  "array",
  "index",
  "unique",
  "foreignKey",
  "vector",
  "optionalOnCreate",
] as const;

/**
 * One of the {@link SNAPSHOT_FIELD_BOOLEAN_PROPS} property names.
 */
export type SnapshotFieldBooleanProp = (typeof SNAPSHOT_FIELD_BOOLEAN_PROPS)[number];

/**
 * Field configuration in schema snapshot
 *
 * **Beta:** This API may change in future releases.
 */
export interface SnapshotFieldConfig {
  type: string;
  required: boolean;
  array?: boolean | undefined;
  index?: boolean | undefined;
  unique?: boolean | undefined;
  allowedValues?: SnapshotEnumValue[] | undefined;
  foreignKey?: boolean | undefined;
  foreignKeyType?: string | undefined;
  foreignKeyField?: string | undefined;
  description?: string | undefined;
  vector?: boolean | undefined;
  hooks?:
    | {
        create?: SnapshotHook | undefined;
        update?: SnapshotHook | undefined;
      }
    | undefined;
  validate?: SnapshotValidation[] | undefined;
  serial?: SnapshotSerial | undefined;
  scale?: number | undefined;
  default?: unknown;
  /** Recorded on remote-derived snapshots when the platform fills the value on create. */
  optionalOnCreate?: boolean | undefined;
  /** Nested fields (recursive) */
  fields?: Record<string, SnapshotFieldConfig> | undefined;
}

/**
 * Index configuration in schema snapshot
 */
export interface SnapshotIndexConfig {
  fields: string[];
  unique?: boolean | undefined;
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
type SnapshotValueOperand = string | boolean | string[] | boolean[];

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
  description?: string | undefined;
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
  description?: string | undefined;
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
 *
 * **Beta:** This API may change in future releases.
 */
export interface TailorDBSnapshotType {
  name: string;
  pluralForm: string;
  description?: string | undefined;
  fields: Record<string, SnapshotFieldConfig>;
  settings?:
    | {
        aggregation?: boolean | undefined;
        bulkUpsert?: boolean | undefined;
        gqlOperations?:
          | {
              create?: boolean | undefined;
              update?: boolean | undefined;
              delete?: boolean | undefined;
              read?: boolean | undefined;
            }
          | undefined;
        publishEvents?: boolean | undefined;
      }
    | undefined;
  indexes?: Record<string, SnapshotIndexConfig> | undefined;
  files?: Record<string, string> | undefined;
  forwardRelationships?: Record<string, SnapshotRelationship> | undefined;
  backwardRelationships?: Record<string, SnapshotRelationship> | undefined;
  permissions?:
    | {
        record?: SnapshotRecordPermission | undefined;
        gql?: SnapshotGqlPermission | undefined;
      }
    | undefined;
  typeHookExpr?: { create?: string | undefined; update?: string | undefined } | undefined;
  typeValidateExpr?: string | undefined;
}

export type SnapshotSettings = NonNullable<TailorDBSnapshotType["settings"]>;
export type SnapshotGqlOperations = NonNullable<SnapshotSettings["gqlOperations"]>;

/** Identifies the history transition created by a full rebaseline. */
export interface RebaselineMarker {
  historyId: string;
  replacedHistoryId: string | null;
  replacedLatestMigration: number;
}

/**
 * Schema snapshot - full schema state at a point in time.
 * Stored as XXXX/schema.json. Defined here (leaf module) so that
 * snapshot-schema.ts can reference it without importing snapshot.ts.
 *
 * **Beta:** This API may change in future releases.
 */
export interface SchemaSnapshot {
  /** Format version for future compatibility */
  version: number;
  namespace: string;
  createdAt: string;
  tables: Record<string, TailorDBSnapshotType>;
  rebaseline?: RebaselineMarker | undefined;
}

declare const normalizedSchemaSnapshotBrand: unique symbol;

/**
 * Schema snapshot normalized to a canonical form for consistent comparison.
 *
 * **Beta:** This API may change in future releases.
 *
 * Returned by snapshot creation and loading functions so drift detection stays
 * stable when local definitions omit defaults that the platform materializes.
 */
export type NormalizedSchemaSnapshot = SchemaSnapshot & {
  readonly [normalizedSchemaSnapshotBrand]: true;
};

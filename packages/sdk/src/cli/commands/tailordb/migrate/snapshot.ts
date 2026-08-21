/**
 * Schema snapshot management for TailorDB migrations
 */

export { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
export { formatMigrationNumber } from "./migration-number";

// ============================================================================
// Snapshot Types
// ============================================================================

// Snapshot data-model types live in snapshot-types.ts (leaf module shared
// with diff-calculator.ts). Re-exported here for backward compatibility.
export { isSnapshotFieldRefOperand } from "./snapshot-types";
export type {
  SnapshotEnumValue,
  SnapshotFieldConfig,
  SnapshotIndexConfig,
  SnapshotRelationship,
  SnapshotPermissionOperand,
  SnapshotPermissionCondition,
  SnapshotActionPermission,
  SnapshotRecordPermission,
  SnapshotGqlPermissionPolicy,
  SnapshotGqlPermission,
  SnapshotGqlOperations,
  SnapshotSettings,
  TailorDBSnapshotType,
  SchemaSnapshot,
  NormalizedSchemaSnapshot,
  RebaselineMarker,
} from "./snapshot-types";

export * from "./snapshot-comparison";
export * from "./snapshot-files";
export * from "./snapshot-migrations";
export * from "./snapshot-local";
export {
  DEFAULT_DECIMAL_SCALE,
  UnsupportedMigrationFileVersionError,
  normalizeSchemaSnapshot,
} from "./snapshot-normalization";
export * from "./snapshot-remote";

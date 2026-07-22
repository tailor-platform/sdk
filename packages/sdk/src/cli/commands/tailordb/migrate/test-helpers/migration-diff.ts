import { SCHEMA_SNAPSHOT_VERSION, type MigrationDiff } from "../diff-calculator";

export function createMockMigrationDiff(options: Partial<MigrationDiff> = {}): MigrationDiff {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: new Date().toISOString(),
    changes: [],
    hasBreakingChanges: false,
    breakingChanges: [],
    hasWarnings: false,
    warnings: [],
    requiresMigrationScript: false,
    ...options,
  };
}

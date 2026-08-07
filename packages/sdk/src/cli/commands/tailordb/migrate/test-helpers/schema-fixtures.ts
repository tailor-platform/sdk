import * as fs from "node:fs";
import * as path from "pathe";
import { SCHEMA_SNAPSHOT_VERSION, type MigrationDiff } from "../diff-calculator";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { SchemaSnapshot, TailorDBSnapshotType } from "../snapshot";

/**
 * Parsed-type shape consumed by createSnapshotFromLocalTypes / createSnapshotType;
 * produces the same snapshot type as {@link snapshotType}.
 * @param {string} name - Type name
 * @returns {TailorDBType} Minimal parsed TailorDB type
 */
export function parsedType(name: string): TailorDBType {
  return {
    name,
    pluralForm: `${name}s`,
    fields: {
      id: { name: "id", config: { type: "uuid", required: true } },
      name: { name: "name", config: { type: "string", required: true } },
    },
    settings: {},
    forwardRelationships: {},
    backwardRelationships: {},
    permissions: {},
  };
}

/**
 * Snapshot-shaped counterpart of {@link parsedType}
 * @param {string} name - Type name
 * @returns {TailorDBSnapshotType} Minimal snapshot type
 */
export function snapshotType(name: string): TailorDBSnapshotType {
  return {
    name,
    pluralForm: `${name}s`,
    fields: {
      id: { type: "uuid", required: true },
      name: { type: "string", required: true },
    },
  };
}

/**
 * Write a 0000 baseline schema snapshot into a migrations directory
 * @param {string} migrationsDir - Migrations directory path
 * @param {Record<string, TailorDBSnapshotType>} types - Snapshot types
 */
export function writeInitialSchema(
  migrationsDir: string,
  types: Record<string, TailorDBSnapshotType>,
): void {
  const snapshot: SchemaSnapshot = {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: "2026-01-01T00:00:00.000Z",
    types,
  };
  const dir = path.join(migrationsDir, "0000");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "schema.json"), JSON.stringify(snapshot));
}

/**
 * Write a numbered diff.json into a migrations directory
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} number - Migration number
 * @param {unknown[]} changes - Diff change entries
 * @param {Partial<MigrationDiff>} overrides - Diff fields to override (e.g. requiresMigrationScript, scriptSkipped)
 */
export function writeDiff(
  migrationsDir: string,
  number: number,
  changes: unknown[],
  overrides: Partial<MigrationDiff> = {},
): void {
  const dir = path.join(migrationsDir, number.toString().padStart(4, "0"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "diff.json"),
    JSON.stringify({
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace: "tailordb",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes,
      hasBreakingChanges: false,
      breakingChanges: [],
      hasWarnings: false,
      warnings: [],
      requiresMigrationScript: false,
      ...overrides,
    }),
  );
}

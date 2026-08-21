import * as fs from "node:fs";
import * as path from "pathe";
import {
  compareSnapshots,
  DIFF_FILE_NAME,
  formatMigrationNumber,
  normalizeSchemaSnapshot,
  SCHEMA_FILE_NAME,
  type CompareSnapshotsOptions,
  type SchemaSnapshot,
} from "../snapshot";
import type { ParsedField, TailorDBType } from "#/parser/service/tailordb/types";
import type { MigrationDiff } from "../diff-calculator";

export function cleanupTestMigrationsBase(baseDir: string): void {
  fs.rmSync(baseDir, { recursive: true, force: true });
  try {
    fs.rmdirSync(path.dirname(baseDir));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTEMPTY")
    ) {
      return;
    }
    throw error;
  }
}

// compareSnapshots takes normalized snapshots; tests build raw fixtures.
export function compareRawSnapshots(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
  options?: CompareSnapshotsOptions,
): MigrationDiff {
  return compareSnapshots(
    normalizeSchemaSnapshot(previous),
    normalizeSchemaSnapshot(current),
    options,
  );
}

export function writeSchemaToDir(
  baseDir: string,
  num: number,
  content: SchemaSnapshot | object,
): string {
  const migDir = path.join(baseDir, formatMigrationNumber(num));
  fs.mkdirSync(migDir, { recursive: true });
  const filePath = path.join(migDir, SCHEMA_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

export function writeDiffToDir(
  baseDir: string,
  num: number,
  content: MigrationDiff | object,
): string {
  const migDir = path.join(baseDir, formatMigrationNumber(num));
  fs.mkdirSync(migDir, { recursive: true });
  const filePath = path.join(migDir, DIFF_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

/**
 * Create a minimal TailorDBType for testing
 * @param {string} name - Type name
 * @param {Record<string, { name: string; config: Partial<ParsedField["config"]> }>} fields - Field definitions
 * @returns {TailorDBType} Mock type with required properties filled
 */
export function createMockType(
  name: string,
  fields: Record<string, { name: string; config: Partial<ParsedField["config"]> }>,
): TailorDBType {
  const parsedFields: Record<string, ParsedField> = {};
  for (const [key, field] of Object.entries(fields)) {
    parsedFields[key] = {
      name: field.name,
      config: {
        type: "string",
        required: false,
        ...field.config,
      },
    };
  }

  return {
    name,
    pluralForm: `${name}s`,
    fields: parsedFields,
    forwardRelationships: {},
    backwardRelationships: {},
    settings: {},
    permissions: {},
  };
}

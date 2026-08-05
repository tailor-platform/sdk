import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { formatMigrationNumber, getMigrationFilePath, MIGRATION_NUMBER_PATTERN } from "./snapshot";
import type { NamespaceWithMigrations } from "./config";

const MIGRATION_FILE_KINDS = ["schema", "diff", "migrate", "db"] as const;

function getMigrationArtifactNumbers(migrationsDir: string): number[] {
  if (!fs.existsSync(migrationsDir)) return [];

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MIGRATION_NUMBER_PATTERN.test(entry.name))
    .map((entry) => Number.parseInt(entry.name, 10))
    .filter((migrationNumber) =>
      MIGRATION_FILE_KINDS.some((kind) =>
        fs.existsSync(getMigrationFilePath(migrationsDir, migrationNumber, kind)),
      ),
    )
    .toSorted((a, b) => a - b);
}

/**
 * Capture an exact set of input files.
 * @param filePaths - Files whose names and contents affect an operation
 * @returns SHA-256 digest of the sorted file set
 */
export function captureFileState(filePaths: ReadonlyArray<string>): string {
  const hash = createHash("sha256");
  for (const filePath of [...new Set(filePaths)].toSorted()) {
    hash.update(filePath);
    hash.update("\0");
    if (fs.existsSync(filePath)) {
      hash.update(fs.readFileSync(filePath));
    } else {
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Capture the migration files that an operation depends on.
 * @param namespacesWithMigrations - Configured migration directories by namespace
 * @returns SHA-256 digest by namespace
 */
export function captureMigrationFileState(
  namespacesWithMigrations: ReadonlyArray<NamespaceWithMigrations>,
): Record<string, string> {
  const state: Record<string, string> = {};
  for (const { namespace, migrationsDir } of namespacesWithMigrations.toSorted((a, b) =>
    a.namespace.localeCompare(b.namespace),
  )) {
    const hash = createHash("sha256");
    const migrationNumbers = getMigrationArtifactNumbers(migrationsDir);
    for (const migrationNumber of migrationNumbers) {
      for (const kind of MIGRATION_FILE_KINDS) {
        const filePath = getMigrationFilePath(migrationsDir, migrationNumber, kind);
        hash.update(`${formatMigrationNumber(migrationNumber)}/${kind}\0`);
        if (fs.existsSync(filePath)) {
          hash.update(fs.readFileSync(filePath));
        } else {
          hash.update("<missing>");
        }
        hash.update("\0");
      }
    }
    state[namespace] = hash.digest("hex");
  }
  return state;
}

import { createHash, type Hash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "pathe";
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

function updateHashWithDirectory(hash: Hash, directoryPath: string, prefix = ""): void {
  const entries = fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      updateHashWithDirectory(hash, entryPath, relativePath);
    } else if (entry.isFile()) {
      hash.update(`file\0${relativePath}\0`);
      hash.update(fs.readFileSync(entryPath));
      hash.update("\0");
    } else if (entry.isSymbolicLink()) {
      hash.update(`symlink\0${relativePath}\0${fs.readlinkSync(entryPath)}\0`);
    } else {
      hash.update(`other\0${relativePath}\0`);
    }
  }
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
      const migrationDirectoryName = formatMigrationNumber(migrationNumber);
      hash.update(`migration\0${migrationDirectoryName}\0`);
      updateHashWithDirectory(hash, path.join(migrationsDir, migrationDirectoryName));
    }
    state[namespace] = hash.digest("hex");
  }
  return state;
}

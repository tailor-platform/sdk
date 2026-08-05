/**
 * Script command for TailorDB migrations
 *
 * Adds a `migrate.ts` (and supporting `db.ts`) template to an existing
 * migration directory. Useful for warning-tier changes where users may
 * want to write a custom data migration even though the change does not
 * automatically require one.
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { getConfiguredEditorCommand, openInConfiguredEditor } from "#/cli/shared/editor";
import { logger, styles } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import { writeDbTypesFile } from "./db-types-generator";
import { parseMigrationNumberArg } from "./migration-number";
import {
  formatMigrationNumber,
  getMigrationFilePath,
  loadDiff,
  reconstructSnapshotFromMigrations,
  INITIAL_SCHEMA_NUMBER,
} from "./snapshot";
import { generateMigrationScript, generateMigrationTestScript } from "./template-generator";
import type { ScriptSkippedInfo } from "./diff-calculator";

export interface ScriptOptions {
  configPath?: string;
  number: string;
  namespace?: string;
  noScript?: boolean;
  reason?: string;
  withTest?: boolean;
}

export interface MarkScriptSkippedOptions {
  migrationsDir: string;
  migrationNumber: number;
  reason: string;
}

export interface AddMigrationScriptFilesOptions {
  migrationsDir: string;
  migrationNumber: number;
  withTest?: boolean;
}

export interface AddMigrationScriptFilesResult {
  /** Created migrate.ts path; undefined when the script already existed. */
  migratePath?: string;
  /** Created db.ts path; undefined when the script already existed. */
  dbTypesPath?: string;
  /** Created migrate.test.ts path; undefined unless withTest was set. */
  testPath?: string;
}

/**
 * Record in diff.json that a migration requiring a script intentionally has none.
 * @param {MarkScriptSkippedOptions} options - Target migration and skip reason
 * @returns {ScriptSkippedInfo} The recorded acknowledgment
 */
export function markMigrationScriptSkipped(options: MarkScriptSkippedOptions): ScriptSkippedInfo {
  const { migrationsDir, migrationNumber, reason } = options;
  const label = formatMigrationNumber(migrationNumber);
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error("Migration script skip reason must not be empty.");
  }

  const diffPath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  if (!fs.existsSync(diffPath)) {
    throw new Error(`Migration ${label} not found in ${migrationsDir}. Expected ${diffPath}.`);
  }

  const diff = loadDiff(diffPath);
  if (!diff.requiresMigrationScript) {
    throw new Error(`Migration ${label} does not require a migration script; nothing to skip.`);
  }
  if (diff.scriptSkipped) {
    throw new Error(
      `Migration ${label} already has a script skip recorded ` +
        `(${diff.scriptSkipped.acknowledgedAt}: ${diff.scriptSkipped.reason}).`,
    );
  }

  const migratePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  if (fs.existsSync(migratePath)) {
    throw new Error(
      `Migration script exists at ${migratePath}. ` +
        `Delete migrate.ts first if this migration should run without a script.`,
    );
  }

  const scriptSkipped: ScriptSkippedInfo = {
    reason: normalizedReason,
    acknowledgedAt: new Date().toISOString(),
  };

  // Edit the raw JSON so keys unknown to this SDK version survive the rewrite.
  const raw = JSON.parse(fs.readFileSync(diffPath, "utf-8")) as Record<string, unknown>;
  raw.scriptSkipped = scriptSkipped;
  fs.writeFileSync(diffPath, JSON.stringify(raw, null, 2));

  return scriptSkipped;
}

/**
 * Remove a script skip acknowledgment after a real migration script is created.
 * @param diffPath - Migration diff file to update
 */
export function clearMigrationScriptSkipped(diffPath: string): void {
  const raw = JSON.parse(fs.readFileSync(diffPath, "utf-8")) as Record<string, unknown>;
  if (!Object.hasOwn(raw, "scriptSkipped")) return;
  delete raw.scriptSkipped;
  fs.writeFileSync(diffPath, JSON.stringify(raw, null, 2));
}

/**
 * Create migration script files (migrate.ts, db.ts, and optionally migrate.test.ts)
 * in an existing migration directory. When migrate.ts already exists and withTest
 * is set, only the test file is added.
 * @param {AddMigrationScriptFilesOptions} options - Target migration and file selection
 * @returns {Promise<AddMigrationScriptFilesResult>} Paths of the created files
 */
export async function addMigrationScriptFiles(
  options: AddMigrationScriptFilesOptions,
): Promise<AddMigrationScriptFilesResult> {
  const { migrationsDir, migrationNumber, withTest = false } = options;
  const label = formatMigrationNumber(migrationNumber);

  const diffPath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  if (!fs.existsSync(diffPath)) {
    throw new Error(`Migration ${label} not found in ${migrationsDir}. Expected ${diffPath}.`);
  }

  const migratePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  const migrateExists = fs.existsSync(migratePath);
  if (migrateExists && !withTest) {
    throw new Error(`Migration script already exists at ${migratePath}.`);
  }

  const testPath = getMigrationFilePath(migrationsDir, migrationNumber, "test");
  if (withTest && fs.existsSync(testPath)) {
    throw new Error(`Migration test already exists at ${testPath}.`);
  }

  const diff = loadDiff(diffPath);
  const result: AddMigrationScriptFilesResult = {};

  if (!migrateExists) {
    // Reconstruct the schema state immediately before this migration so that
    // db.ts has Kysely types for the previous shape of the data.
    const previousSnapshot = reconstructSnapshotFromMigrations(migrationsDir, migrationNumber - 1);
    if (!previousSnapshot) {
      throw new Error(
        `Could not reconstruct previous schema for migration ${label}. Make sure migration ${INITIAL_SCHEMA_NUMBER} exists.`,
      );
    }

    await fsPromises.writeFile(migratePath, generateMigrationScript(diff));
    result.migratePath = migratePath;
    result.dbTypesPath = await writeDbTypesFile(
      previousSnapshot,
      migrationsDir,
      migrationNumber,
      diff,
    );
    clearMigrationScriptSkipped(diffPath);
  }

  if (withTest) {
    await fsPromises.writeFile(testPath, generateMigrationTestScript(diff));
    result.testPath = testPath;
  }

  return result;
}

/**
 * Add a migrate.ts template to an existing migration directory.
 * @param {ScriptOptions} options - Command options
 */
async function script(options: ScriptOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const migrationNumber = parseMigrationNumberArg(options.number);

  if (migrationNumber === INITIAL_SCHEMA_NUMBER) {
    throw new Error(
      `Migration ${options.number} is the initial schema snapshot and cannot have a migration script.`,
    );
  }

  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  const targetNamespace = resolveTargetNamespace(namespacesWithMigrations, options.namespace);
  const { migrationsDir } = assertDefined(
    namespacesWithMigrations.find((ns) => ns.namespace === targetNamespace),
    "namespace with migrations not found",
  );

  if (options.noScript) {
    if (options.withTest) {
      throw new Error("--with-test cannot be used together with --no-script.");
    }
    const reason = options.reason?.trim();
    if (!reason) {
      throw new Error("--reason is required with --no-script.");
    }
    const scriptSkipped = markMigrationScriptSkipped({
      migrationsDir,
      migrationNumber,
      reason,
    });
    logger.success(
      `Recorded that migration ${styles.bold(options.number)} in namespace ${styles.bold(targetNamespace)} intentionally has no migration script`,
    );
    logger.info(`  Reason: ${scriptSkipped.reason}`);
    logger.info(`  Diff file: ${getMigrationFilePath(migrationsDir, migrationNumber, "diff")}`);
    return;
  }
  if (options.reason !== undefined) {
    throw new Error("--reason can only be used together with --no-script.");
  }

  const result = await addMigrationScriptFiles({
    migrationsDir,
    migrationNumber,
    withTest: options.withTest,
  });

  const added = result.migratePath ? "migration script" : "migration test";
  logger.success(
    `Added ${added} for migration ${styles.bold(options.number)} in namespace ${styles.bold(targetNamespace)}`,
  );
  if (result.migratePath) {
    logger.info(`  Migration script: ${result.migratePath}`);
    logger.info(`  DB types: ${result.dbTypesPath}`);
  }
  if (result.testPath) {
    logger.info(`  Migration test: ${result.testPath}`);
  }

  logger.newline();
  if (result.migratePath) {
    logger.log("Edit the script to implement your data migration logic.");
    logger.log("It will be executed by 'tailor deploy' between Pre and Post phases.");
  }
  if (result.testPath) {
    logger.log("Fill in the test with the rows to stage and the statements to assert.");
  }

  const fileToOpen = result.migratePath ?? result.testPath;
  if (!fileToOpen) return;

  const editor = getConfiguredEditorCommand();
  if (!editor) return;

  logger.newline();
  logger.info(`Opening ${path.basename(fileToOpen)} in ${editor}...`);
  try {
    await openInConfiguredEditor(fileToOpen);
  } catch {
    return;
  }
}

function resolveTargetNamespace(
  namespacesWithMigrations: NamespaceWithMigrations[],
  requested?: string,
): string {
  if (requested) {
    if (!namespacesWithMigrations.some((ns) => ns.namespace === requested)) {
      throw new Error(`Namespace "${requested}" not found or does not have migrations configured`);
    }
    return requested;
  }
  if (namespacesWithMigrations.length === 1) {
    const [ns] = namespacesWithMigrations;
    return assertDefined(ns, "namespace with migrations missing").namespace;
  }
  throw new Error(
    `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations.map((ns) => ns.namespace).join(", ")}`,
  );
}

export const scriptCommand = defineAppCommand({
  name: "script",
  description:
    "Add a migration script (migrate.ts) template to an existing migration directory, or record with --no-script that a migration intentionally has none.",
  args: z.strictObject({
    ...configArg,
    number: arg(z.string(), {
      positional: true,
      description: "Migration number to add a script to (e.g., 0001 or 1)",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
    }),
    "no-script": arg(z.boolean().optional(), {
      description:
        "Record that this migration intentionally runs without a migration script (requires --reason)",
    }),
    reason: arg(z.string().optional(), {
      description: "Reason why no migration script is needed (used with --no-script)",
    }),
    "with-test": arg(z.boolean().optional(), {
      description:
        "Also add a migrate.test.ts unit-test scaffold; when migrate.ts already exists, only the test is added",
    }),
  }),
  run: async (args) => {
    await script({
      configPath: args.config,
      number: args.number,
      namespace: args.namespace,
      noScript: args["no-script"],
      reason: args.reason,
      withTest: args["with-test"],
    });
  },
});

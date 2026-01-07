/**
 * Generate command for TailorDB migrations
 *
 * Generates migration files based on local schema snapshots:
 * - First run: Creates initial schema snapshot (0000/schema.json)
 * - Subsequent runs: Creates diff from previous snapshot (0001/diff.json, etc.)
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineCommand } from "citty";
import { commonArgs, withCommonArgs } from "../../args";
import { loadConfig } from "../../config-loader";
import { logger, styles } from "../../utils/logger";
import {
  formatMigrationDiff,
  formatBreakingChanges,
  formatDiffSummary,
  hasChanges,
} from "./diff-calculator";
import {
  createSnapshotFromLocalTypes,
  reconstructSnapshotFromMigrations,
  compareSnapshots,
  getNextMigrationNumber,
  assertValidMigrationFiles,
} from "./snapshot";
import { generateSchemaFile, generateDiffFiles } from "./template-generator";
import { getNamespacesWithMigrations, INITIAL_SCHEMA_NUMBER } from "./types";
import type { NamespaceWithMigrations, SchemaSnapshot } from "./types";

export interface GenerateOptions {
  configPath?: string;
  name?: string;
  yes?: boolean;
}

/**
 * Generate migration files for TailorDB schema changes
 * @param {GenerateOptions} options - Generation options
 * @returns {Promise<void>} Promise that resolves when generation is complete
 */
export async function generate(options: GenerateOptions): Promise<void> {
  // Load configuration
  const { config, configPath } = await loadConfig(options.configPath);
  const configDir = path.dirname(configPath);

  // Get namespaces with migrations config
  const namespacesWithMigrations: NamespaceWithMigrations[] = getNamespacesWithMigrations(
    config,
    configDir,
  );

  if (namespacesWithMigrations.length === 0) {
    logger.warn("No TailorDB namespaces with migrations config found.");
    logger.info('Add "migrations" field to your db config to enable migrations.');
    return;
  }

  // Load application and all types
  const { defineApplication } = await import("../../application");
  const application = defineApplication(config);

  // Process each namespace
  for (const { namespace, migrationsDir } of namespacesWithMigrations) {
    logger.info(`Processing namespace: ${styles.bold(namespace)}`);

    // Validate existing migration files before generating new ones
    assertValidMigrationFiles(migrationsDir, namespace);

    // Find the TailorDB service for this namespace
    const tailordbService = application.tailorDBServices.find((s) => s.namespace === namespace);
    if (!tailordbService) {
      logger.warn(`No TailorDB service found for namespace "${namespace}"`);
      continue;
    }

    // Load types for this service
    await tailordbService.loadTypes();

    const localTypesObj = tailordbService.getTypes();

    // Create snapshot from current local types
    const currentSnapshot = createSnapshotFromLocalTypes(localTypesObj, namespace);

    // Check if migrations directory exists and has snapshots
    let previousSnapshot: SchemaSnapshot | null = null;
    try {
      previousSnapshot = reconstructSnapshotFromMigrations(migrationsDir);
    } catch {
      // No previous migrations - this is fine
    }

    if (!previousSnapshot) {
      // First migration - generate initial schema snapshot
      await generateInitialSnapshot(currentSnapshot, migrationsDir);
    } else {
      // Compare with previous snapshot and generate diff
      await generateDiffFromSnapshot(previousSnapshot, currentSnapshot, migrationsDir, options);
    }
  }
}

/**
 * Generate the initial schema snapshot
 * @param {SchemaSnapshot} snapshot - Schema snapshot to save
 * @param {string} migrationsDir - Migrations directory path
 * @returns {Promise<void>} Promise that resolves when snapshot is generated
 */
async function generateInitialSnapshot(
  snapshot: SchemaSnapshot,
  migrationsDir: string,
): Promise<void> {
  const result = await generateSchemaFile(snapshot, migrationsDir, INITIAL_SCHEMA_NUMBER);

  logger.success(`Generated initial schema snapshot`);
  logger.info(`  File: ${result.filePath}`);
  logger.info(`  Types: ${Object.keys(snapshot.types).length}`);

  logger.log("\nThis is the baseline schema. Future changes will be tracked as diffs.");
}

/**
 * Generate diff from previous snapshot
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @param {string} migrationsDir - Migrations directory path
 * @param {GenerateOptions} options - Generate options
 * @returns {Promise<void>} Promise that resolves when diff is generated
 */
async function generateDiffFromSnapshot(
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
  migrationsDir: string,
  options: GenerateOptions,
): Promise<void> {
  // Calculate diff
  const diff = compareSnapshots(previousSnapshot, currentSnapshot);

  // Check if there are any changes
  if (!hasChanges(diff)) {
    logger.info("No schema differences detected.");
    return;
  }

  // Display diff
  logger.newline();
  logger.log(formatMigrationDiff(diff));
  logger.newline();
  logger.info(`Summary: ${formatDiffSummary(diff)}`);

  // Check for unsupported field structure changes (type change, array flag change)
  for (const change of diff.breakingChanges) {
    if (change.reason.startsWith("Field type changed")) {
      logger.newline();
      logger.error(
        `Field type change is not supported yet: ${change.typeName}.${change.fieldName}`,
      );
      logger.error(`  ${change.reason}`);
      logger.newline();
      logger.info("To change a field type, you need 3 migrations:");
      logger.info("  Migration 1: Add a new field with the desired type (e.g., fieldName_new)");
      logger.info("               and migrate data from old field to new field");
      logger.info("  Migration 2: Remove the old field");
      logger.info("  Migration 3: Add the field with the original name and new type,");
      logger.info("               migrate data from temporary field, then remove temporary field");
      throw new Error("Field type change is not supported");
    }

    if (change.reason.includes("array to single value")) {
      logger.newline();
      logger.error(
        `Array to single value change is not supported yet: ${change.typeName}.${change.fieldName}`,
      );
      logger.error(`  ${change.reason}`);
      logger.newline();
      logger.info("To change a field from array to single value, you need 3 migrations:");
      logger.info(
        "  Migration 1: Add a new field (single value) and migrate data from array field",
      );
      logger.info("  Migration 2: Remove the old array field");
      logger.info("  Migration 3: Add the field with the original name as single value,");
      logger.info("               migrate data from temporary field, then remove temporary field");
      throw new Error("Array to single value change is not supported");
    }
  }

  // Warn about breaking changes
  if (diff.hasBreakingChanges) {
    logger.newline();
    logger.warn(formatBreakingChanges(diff.breakingChanges));

    if (!options.yes) {
      const confirmation = await logger.prompt("Continue generating migration?", {
        type: "confirm",
        initial: true,
        cancel: "symbol",
      });

      if (confirmation !== true) {
        logger.info("Migration generation cancelled.");
        return;
      }
      logger.newline();
    }
  }

  // Get next migration number
  const migrationNumber = getNextMigrationNumber(migrationsDir);

  // Generate diff and optional migration script (pass previousSnapshot for db.ts generation)
  const result = await generateDiffFiles(
    diff,
    migrationsDir,
    migrationNumber,
    previousSnapshot,
    options.name,
  );

  logger.success(
    `Generated migration ${styles.bold(result.migrationNumber.toString().padStart(4, "0"))}`,
  );
  logger.info(`  Diff file: ${result.diffFilePath}`);

  if (result.migrateFilePath) {
    logger.info(`  Migration script: ${result.migrateFilePath}`);
    if (result.dbTypesFilePath) {
      logger.info(`  DB types: ${result.dbTypesFilePath}`);
    }
    logger.newline();
    logger.log("A migration script was generated for breaking changes.");
    logger.log("Please review and edit the script before running 'tailor-sdk apply'.");

    // Open script file in editor if EDITOR is set
    await openInEditor(result.migrateFilePath);
  }
}

/**
 * Open a file in the user's preferred editor
 * @param {string} filePath - Path to file to open
 * @returns {Promise<void>} Promise that resolves when editor closes
 */
async function openInEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR;
  if (!editor) {
    return;
  }

  try {
    await fs.access(filePath);
  } catch {
    return;
  }

  logger.newline();
  logger.info(`Opening ${path.basename(filePath)} in ${editor}...`);

  // Spawn editor as detached process
  const child = spawn(editor, [filePath], {
    stdio: "inherit",
    detached: false,
  });

  // Wait for editor to close
  await new Promise<void>((resolve) => {
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

/**
 * CLI command definition for generate
 */
export const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Generate migration files for TailorDB schema changes",
  },
  args: {
    ...commonArgs,
    name: {
      type: "string",
      description: "Optional description for the migration",
      alias: "n",
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompts",
      alias: "y",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    await generate({
      configPath: typeof args.config === "string" ? args.config : undefined,
      name: typeof args.name === "string" ? args.name : undefined,
      yes: Boolean(args.yes),
    });
  }),
});

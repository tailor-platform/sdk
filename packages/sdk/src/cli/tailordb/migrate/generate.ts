/**
 * Generate command for TailorDB migrations
 *
 * Generates migration files based on local schema snapshots:
 * - First run: Creates initial schema snapshot (0000/schema.json)
 * - Subsequent runs: Creates diff from previous snapshot (0001/diff.json, etc.)
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "pathe";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "../../args";
import { loadConfig } from "../../config-loader";
import { logBetaWarning } from "../../utils/beta";
import { logger, styles } from "../../utils/logger";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
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
  INITIAL_SCHEMA_NUMBER,
  type SchemaSnapshot,
} from "./snapshot";
import { generateSchemaFile, generateDiffFiles } from "./template-generator";

export interface GenerateOptions {
  configPath?: string;
  name?: string;
  yes?: boolean;
  init?: boolean;
}

/**
 * Handle --init option: delete existing migrations directories
 * @param {NamespaceWithMigrations[]} namespaces - Namespaces with migrations
 * @param {boolean} skipConfirmation - Whether to skip confirmation prompt
 * @returns {Promise<void>}
 */
async function handleInitOption(
  namespaces: NamespaceWithMigrations[],
  skipConfirmation?: boolean,
): Promise<void> {
  // Find directories that exist
  const existingDirs = namespaces.filter(({ migrationsDir }) => fs.existsSync(migrationsDir));

  if (existingDirs.length === 0) {
    logger.info("No existing migration directories found.");
    return;
  }

  // Show warning
  logger.newline();
  logger.warn("This will DELETE all existing migration files:");
  for (const { namespace, migrationsDir } of existingDirs) {
    logger.log(`  - ${namespace}: ${migrationsDir}`);
  }
  logger.newline();

  // Confirmation prompt
  if (!skipConfirmation) {
    const confirmation = await logger.prompt(
      "Are you sure you want to delete these directories and start fresh?",
      {
        type: "confirm",
        initial: false,
      },
    );

    if (!confirmation) {
      logger.info("Operation cancelled.");
      process.exit(0);
    }
    logger.newline();
  }

  // Delete directories
  for (const { namespace, migrationsDir } of existingDirs) {
    try {
      await fsPromises.rm(migrationsDir, { recursive: true, force: true });
      logger.success(`Deleted migration directory for ${styles.bold(namespace)}`);
    } catch (error) {
      logger.error(`Failed to delete ${migrationsDir}: ${error}`);
      throw error;
    }
  }

  logger.newline();
  logger.info("Migration directories cleared. Generating initial snapshot...");
  logger.newline();
}

/**
 * Generate migration files for TailorDB schema changes
 * @param {GenerateOptions} options - Generation options
 * @returns {Promise<void>} Promise that resolves when generation is complete
 */
export async function generate(options: GenerateOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  // Load configuration
  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  // Get namespaces with migrations config
  const namespacesWithMigrations: NamespaceWithMigrations[] = getNamespacesWithMigrations(
    config,
    configDir,
  );

  if (namespacesWithMigrations.length === 0) {
    logger.warn("No TailorDB namespaces with migrations config found.");
    logger.info(
      'Add "migration: { directory: \\"./migrations\\" }" to your db config to enable migrations.',
    );
    return;
  }

  // Handle --init option: delete existing migrations directory
  if (options.init) {
    await handleInitOption(namespacesWithMigrations, options.yes);
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

  // Check for unsupported changes
  const unsupportedChanges = diff.breakingChanges.filter((change) => change.unsupported);
  if (unsupportedChanges.length > 0) {
    for (const change of unsupportedChanges) {
      logger.newline();
      logger.error(`Unsupported change: ${change.typeName}.${change.fieldName}`);
      logger.error(`  ${change.reason}`);
    }

    // Show 3-step migration hint if any unsupported change requires it
    if (unsupportedChanges.some((change) => change.showThreeStepHint)) {
      logger.newline();
      logger.info("These changes require a manual 3-step migration process:");
      logger.info("  Migration 1: Add a new field with the desired structure");
      logger.info("               and migrate data from old field to new field");
      logger.info("  Migration 2: Remove the old field");
      logger.info("  Migration 3: Add the field with the original name and new structure,");
      logger.info("               migrate data from temporary field, then remove temporary field");
    }

    const details = unsupportedChanges
      .map((c) => `  - ${c.typeName}.${c.fieldName}: ${c.reason}`)
      .join("\n");
    throw new Error(`Unsupported schema changes detected:\n${details}`);
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
    await fsPromises.access(filePath);
  } catch {
    return;
  }

  // Parse editor command and arguments
  const [command, ...args] = editor.trim().split(/\s+/);

  logger.newline();
  logger.info(`Opening ${path.basename(filePath)} in ${editor}...`);

  // Spawn editor with parsed command and arguments
  const child = spawn(command, [...args, filePath], {
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
  name: "generate",
  description: "Generate migration files for TailorDB schema changes",
  args: z.object({
    ...commonArgs,
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
    name: arg(z.string().optional(), {
      alias: "n",
      description: "Optional description for the migration",
    }),
    yes: arg(z.boolean().default(false), {
      alias: "y",
      description: "Skip confirmation prompts",
    }),
    init: arg(z.boolean().default(false), {
      description: "Delete existing migrations and start fresh",
    }),
  }),
  run: withCommonArgs(async (args) => {
    await generate({
      configPath: args.config,
      name: args.name,
      yes: args.yes,
      init: args.init,
    });
  }),
});

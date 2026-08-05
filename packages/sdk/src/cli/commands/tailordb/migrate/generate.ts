/**
 * Generate command for TailorDB migrations
 *
 * Generates migration files based on local schema snapshots:
 * - First run: Creates initial schema snapshot (0000/schema.json)
 * - Subsequent runs: Creates diff from previous snapshot (0001/diff.json, etc.)
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg, confirmationArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { getConfiguredEditorCommand, openInConfiguredEditor } from "#/cli/shared/editor";
import { logger, styles } from "#/cli/shared/logger";
import { canPrompt, prompt } from "#/cli/shared/prompt";
import { PluginManager } from "#/plugin/manager";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import {
  formatMigrationDiff,
  formatBreakingChanges,
  formatDiffSummary,
  formatWarnings,
  hasChanges,
  type MigrationDiff,
} from "./diff-calculator";
import {
  findRenameCandidates,
  parseRenameOption,
  type FieldRenameCandidate,
  type FieldRenameSpec,
} from "./rename-detection";
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
  /** `--rename Type.old:new` values confirming field renames non-interactively. */
  renames?: string[];
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
    const confirmation = await prompt.confirm({
      message: "Are you sure you want to delete these directories and start fresh?",
      default: false,
    });

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
  const { config, plugins } = await loadConfig(options.configPath);
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

  // Parse --rename flags before any destructive step so a malformed value
  // fails the command while the migrations directories are still intact
  const renameFlags: RenameFlag[] = (options.renames ?? []).map((raw) => ({
    raw,
    spec: parseRenameOption(raw),
    used: false,
  }));

  // Handle --init option: delete existing migrations directory
  if (options.init) {
    await handleInitOption(namespacesWithMigrations, options.yes);
  }

  // Initialize plugin manager if plugins are provided
  let pluginManager: PluginManager | undefined;
  if (plugins.length > 0) {
    pluginManager = new PluginManager(plugins);
  }

  // Load application and all types
  const { defineApplication } = await import("#/cli/services/application");
  const application = defineApplication({ config, pluginManager });

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
    await tailordbService.processNamespacePlugins();

    const localTypesObj = tailordbService.types;

    // Create snapshot from current local types
    const currentSnapshot = createSnapshotFromLocalTypes(localTypesObj, namespace);

    // Returns null when the migrations directory is missing or empty;
    // throws when existing migration files are invalid.
    const previousSnapshot: SchemaSnapshot | null =
      reconstructSnapshotFromMigrations(migrationsDir);

    if (!previousSnapshot) {
      // First migration - generate initial schema snapshot
      await generateInitialSnapshot(currentSnapshot, migrationsDir);
    } else {
      // Compare with previous snapshot and generate diff
      await generateDiffFromSnapshot(
        previousSnapshot,
        currentSnapshot,
        migrationsDir,
        options,
        renameFlags,
      );
    }
  }

  const unusedRenames = renameFlags.filter((flag) => !flag.used);
  if (unusedRenames.length > 0) {
    throw new Error(
      `--rename did not match any schema change: ${unusedRenames.map((flag) => flag.raw).join(", ")}`,
    );
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

/** A parsed `--rename` flag together with its raw value and usage tracking. */
interface RenameFlag {
  raw: string;
  spec: FieldRenameSpec;
  used: boolean;
}

function renameCandidateLabels(
  candidate: FieldRenameCandidate,
  claimedFields: ReadonlySet<string>,
): string[] {
  return candidate.added
    .filter((added) => !claimedFields.has(`${candidate.typeName}.${added.fieldName}`))
    .map((added) => added.fieldName);
}

/**
 * Ask the user whether a removed field was renamed to one of the compatible
 * added fields. Returns the confirmed new field name, or undefined.
 * @param {FieldRenameCandidate} candidate - Candidate to confirm
 * @param {string[]} addedFieldNames - Added field names still available as rename targets
 * @returns {Promise<string | undefined>} Confirmed new field name, if any
 */
async function promptRenameCandidate(
  candidate: FieldRenameCandidate,
  addedFieldNames: string[],
): Promise<string | undefined> {
  const oldLabel = `${candidate.typeName}.${candidate.removed.fieldName}`;
  const [firstFieldName] = addedFieldNames;
  if (addedFieldNames.length === 1 && firstFieldName) {
    const isRename = await prompt.confirm({
      message: `${oldLabel} was removed and ${firstFieldName} was added with a compatible type. Was it renamed to ${firstFieldName}?`,
      default: true,
    });
    return isRename ? firstFieldName : undefined;
  }
  const selected = await prompt.select({
    message: `${oldLabel} was removed. Was it renamed to one of these added fields?`,
    choices: [
      ...addedFieldNames.map((fieldName) => ({
        name: `Yes, renamed to ${fieldName}`,
        value: fieldName as string | null,
      })),
      { name: `No, ${candidate.removed.fieldName} was removed`, value: null },
    ],
  });
  return selected ?? undefined;
}

/**
 * Resolve field renames for a diff: apply `--rename` flags, then confirm
 * remaining candidates interactively (or warn when prompting is unavailable),
 * and recompute the diff with the confirmed renames.
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @param {MigrationDiff} diff - Diff computed without rename knowledge
 * @param {GenerateOptions} options - Generate options
 * @param {RenameFlag[]} renameFlags - Parsed `--rename` flags (marked used when they apply to this namespace)
 * @returns {Promise<MigrationDiff>} Diff with confirmed renames recorded
 */
async function resolveFieldRenames(
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
  diff: MigrationDiff,
  options: GenerateOptions,
  renameFlags: RenameFlag[],
): Promise<MigrationDiff> {
  // A flag applies here only when this namespace actually removed the old
  // field and added the new one; another namespace may define a type with the
  // same name. Flags that match no namespace are reported after the loop.
  const applicableFlags = renameFlags.filter(({ spec }) => {
    const prevFields = previousSnapshot.types[spec.typeName]?.fields;
    const currFields = currentSnapshot.types[spec.typeName]?.fields;
    return Boolean(
      prevFields?.[spec.fromFieldName] &&
      !currFields?.[spec.fromFieldName] &&
      currFields?.[spec.toFieldName] &&
      !prevFields[spec.toFieldName],
    );
  });
  for (const flag of applicableFlags) {
    flag.used = true;
  }
  const confirmed: FieldRenameSpec[] = applicableFlags.map((flag) => flag.spec);
  const claimedFields = new Set(
    confirmed.flatMap((spec) => [
      `${spec.typeName}.${spec.fromFieldName}`,
      `${spec.typeName}.${spec.toFieldName}`,
    ]),
  );

  const candidates = findRenameCandidates(diff).filter(
    (candidate) =>
      !claimedFields.has(`${candidate.typeName}.${candidate.removed.fieldName}`) &&
      renameCandidateLabels(candidate, claimedFields).length > 0,
  );

  if (candidates.length > 0 && (options.yes || !canPrompt())) {
    logger.newline();
    logger.warn("Possible field rename(s) detected; they will be treated as remove + add:");
    for (const candidate of candidates) {
      const targets = renameCandidateLabels(candidate, claimedFields).join(", ");
      logger.warn(`  - ${candidate.typeName}.${candidate.removed.fieldName} → ${targets}?`, {
        mode: "plain",
      });
    }
    logger.info(
      'If a field was renamed, re-run with --rename "Type.oldField:newField" to record the rename and scaffold a data copy script.',
    );
  } else {
    for (const candidate of candidates) {
      const addedFieldNames = renameCandidateLabels(candidate, claimedFields);
      if (addedFieldNames.length === 0) continue;
      const newFieldName = await promptRenameCandidate(candidate, addedFieldNames);
      if (newFieldName) {
        confirmed.push({
          typeName: candidate.typeName,
          fromFieldName: candidate.removed.fieldName,
          toFieldName: newFieldName,
        });
        claimedFields.add(`${candidate.typeName}.${candidate.removed.fieldName}`);
        claimedFields.add(`${candidate.typeName}.${newFieldName}`);
      }
    }
  }

  if (confirmed.length === 0) return diff;
  return compareSnapshots(previousSnapshot, currentSnapshot, { fieldRenames: confirmed });
}

/**
 * Generate diff from previous snapshot
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @param {string} migrationsDir - Migrations directory path
 * @param {GenerateOptions} options - Generate options
 * @param {RenameFlag[]} renameFlags - Parsed `--rename` flags
 * @returns {Promise<void>} Promise that resolves when diff is generated
 */
async function generateDiffFromSnapshot(
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
  migrationsDir: string,
  options: GenerateOptions,
  renameFlags: RenameFlag[],
): Promise<void> {
  // Calculate diff
  let diff = compareSnapshots(previousSnapshot, currentSnapshot);

  // Check if there are any changes
  if (!hasChanges(diff)) {
    logger.info("No schema differences detected.");
    return;
  }

  // Recompute the diff with confirmed field renames (via --rename or prompts)
  diff = await resolveFieldRenames(previousSnapshot, currentSnapshot, diff, options, renameFlags);

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
      const confirmation = await prompt.confirm({
        message: "Continue generating migration?",
        default: true,
      });

      if (!confirmation) {
        logger.info("Migration generation cancelled.");
        return;
      }
      logger.newline();
    }
  }

  // Warn about non-breaking but data-loss-possible changes (e.g. field/type removal)
  if (diff.hasWarnings) {
    logger.newline();
    logger.warn(formatWarnings(diff.warnings));
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
    logger.log("Please review and edit the script before running 'tailor deploy'.");

    const editor = getConfiguredEditorCommand();
    if (!editor) {
      return;
    }

    try {
      await fsPromises.access(result.migrateFilePath);
    } catch {
      return;
    }

    logger.newline();
    logger.info(`Opening ${path.basename(result.migrateFilePath)} in ${editor}...`);

    try {
      await openInConfiguredEditor(result.migrateFilePath);
    } catch {
      return;
    }
  } else if (diff.hasWarnings) {
    logger.newline();
    logger.log(
      `Data loss is possible for this migration but no script was generated. To add a custom migrate.ts, run:`,
    );
    logger.log(
      `  ${styles.bold(`tailor tailordb migration script ${result.migrationNumber.toString().padStart(4, "0")} --namespace ${diff.namespace}`)}`,
    );
  }
}

/**
 * CLI command definition for generate
 */
export const generateCommand = defineAppCommand({
  name: "generate",
  description:
    "Generate migration files by detecting schema differences between current local types and the previous migration snapshot.",
  args: z.strictObject({
    ...confirmationArgs,
    ...configArg,
    name: arg(z.string().optional(), {
      alias: "n",
      description: "Optional description for the migration",
    }),
    init: arg(z.boolean().default(false), {
      description: "Delete existing migrations and start fresh",
    }),
    rename: arg(z.array(z.string()).optional(), {
      description:
        'Record a field rename instead of remove + add (format: "Type.oldField:newField"; repeatable). Renames require a migration script that copies the data.',
    }),
  }),
  run: async (args) => {
    await generate({
      configPath: args.config,
      name: args.name,
      yes: args.yes,
      init: args.init,
      renames: args.rename,
    });
  },
});

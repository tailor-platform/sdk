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
import { assertDefined } from "#/utils/assert";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import {
  formatMigrationDiff,
  formatBreakingChanges,
  formatDiffSummary,
  formatWarnings,
  hasChanges,
  type MigrationDiff,
} from "./diff-calculator";
import { fieldKey, planExpandContract, type ExpandContractPlan } from "./expand-contract";
import { supportsExpandContractFieldChange } from "./field-type-change";
import { formatMigrationScriptCommand } from "./hints";
import {
  dropSpecApplies,
  expandContractSpecApplies,
  findRenameCandidates,
  parseDropOption,
  parseExpandContractOption,
  parseRenameOption,
  renameSpecApplies,
  type FieldDropSpec,
  type FieldExpandContractSpec,
  type FieldRenameCandidate,
  type FieldRenameSpec,
} from "./rename-detection";
import { markMigrationScriptSkipped } from "./script";
import {
  buildIntermediateSnapshot,
  createSnapshotFromLocalTypes,
  reconstructSnapshotFromMigrations,
  compareSnapshots,
  getNextMigrationNumber,
  assertValidMigrationFiles,
  formatMigrationNumber,
  INITIAL_SCHEMA_NUMBER,
  type NormalizedSchemaSnapshot,
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
  /** `--drop Type.field` values confirming field removals non-interactively. */
  drops?: string[];
  /** `--expand-contract Type.field` values approving a field type conversion. */
  expandContracts?: string[];
}

/**
 * Build the safety-critical manual migration guidance for unsupported changes.
 * @returns Lines to write through the CLI logger
 */
export function getUnsupportedMigrationHintLines(): string[] {
  return [
    "These changes require a manual 3-step migration process:",
    "  Migration 1: Add an optional temporary field with the desired structure",
    "               If the old field is required, make the old field optional",
    "               For each non-null old value, copy and convert it to the temporary field",
    "               and set the old field to null in the same update",
    "               Verify every old value is null before continuing",
    "  Migration 2: Remove the old field",
    "  Migration 3: Add the field with the original name and new structure,",
    "               migrate data from the temporary field, then remove it",
    "  Important: Reusing the name while stored old values remain can make subsequent reads fail",
  ];
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

  // Parse --rename/--drop flags before any destructive step so a malformed
  // value fails the command while the migrations directories are still intact
  const renameFlags: RenameFlag[] = (options.renames ?? []).map((raw) => ({
    raw,
    spec: parseRenameOption(raw),
  }));
  const dropFlags: DropFlag[] = (options.drops ?? []).map((raw) => ({
    raw,
    spec: parseDropOption(raw),
  }));
  const expandContractFlags: ExpandContractFlag[] = (options.expandContracts ?? []).map((raw) => ({
    raw,
    spec: parseExpandContractOption(raw),
  }));
  // --init regenerates the baseline from scratch, so there is no previous
  // schema a rename, drop, or field conversion could apply to
  if (
    options.init &&
    (renameFlags.length > 0 || dropFlags.length > 0 || expandContractFlags.length > 0)
  ) {
    throw new Error("--rename, --drop, and --expand-contract cannot be used together with --init.");
  }
  const droppedFieldKeys = new Set(
    dropFlags.map(({ spec }) => `${spec.typeName}.${spec.fieldName}`),
  );
  const conflictingFlags = renameFlags.filter(({ spec }) =>
    droppedFieldKeys.has(`${spec.typeName}.${spec.previousFieldName}`),
  );
  if (conflictingFlags.length > 0) {
    throw new Error(
      `--rename and --drop conflict for: ${conflictingFlags
        .map(({ spec }) => `${spec.typeName}.${spec.previousFieldName}`)
        .join(", ")}`,
    );
  }

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

  // Load every namespace's snapshots first so --rename flags can be validated
  // against all of them before any migration file is written
  const generations: NamespaceGeneration[] = [];
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

    generations.push({
      namespace,
      migrationsDir,
      // Create snapshot from current local types
      currentSnapshot: createSnapshotFromLocalTypes(localTypesObj, namespace),
      // Returns null when the migrations directory is missing or empty;
      // throws when existing migration files are invalid.
      previousSnapshot: reconstructSnapshotFromMigrations(migrationsDir),
    });
  }

  // A flag applies to a namespace only when that namespace actually removed
  // the old field (and, for renames, added the new one); another namespace
  // may define a type with the same name
  const renameSpecsByNamespace = new Map<string, FieldRenameSpec[]>();
  const dropSpecsByNamespace = new Map<string, FieldDropSpec[]>();
  const matchedRenameFlags = new Set<RenameFlag>();
  const matchedDropFlags = new Set<DropFlag>();
  for (const { namespace, previousSnapshot, currentSnapshot } of generations) {
    if (!previousSnapshot) continue;
    const applicableRenames = renameFlags.filter(({ spec }) =>
      renameSpecApplies(spec, previousSnapshot, currentSnapshot),
    );
    for (const flag of applicableRenames) {
      matchedRenameFlags.add(flag);
    }
    renameSpecsByNamespace.set(
      namespace,
      applicableRenames.map((flag) => flag.spec),
    );
    const applicableDrops = dropFlags.filter(({ spec }) =>
      dropSpecApplies(spec, previousSnapshot, currentSnapshot),
    );
    for (const flag of applicableDrops) {
      matchedDropFlags.add(flag);
    }
    dropSpecsByNamespace.set(
      namespace,
      applicableDrops.map((flag) => flag.spec),
    );
  }

  const unusedRenames = renameFlags.filter((flag) => !matchedRenameFlags.has(flag));
  if (unusedRenames.length > 0) {
    throw new Error(
      `--rename does not match a removed + added field pair: ${unusedRenames.map((flag) => flag.raw).join(", ")}`,
    );
  }
  const unusedDrops = dropFlags.filter((flag) => !matchedDropFlags.has(flag));
  if (unusedDrops.length > 0) {
    throw new Error(
      `--drop does not match a removed field: ${unusedDrops.map((flag) => flag.raw).join(", ")}`,
    );
  }

  const expandContractKeysByNamespace = new Map<string, Set<string>>();
  const matchedExpandContractFlags = new Set<ExpandContractFlag>();
  for (const { namespace, previousSnapshot, currentSnapshot } of generations) {
    if (!previousSnapshot) continue;
    const applicable = expandContractFlags.filter(({ spec }) =>
      expandContractSpecApplies(spec, previousSnapshot, currentSnapshot),
    );
    for (const flag of applicable) {
      matchedExpandContractFlags.add(flag);
    }
    expandContractKeysByNamespace.set(
      namespace,
      new Set(applicable.map(({ spec }) => fieldKey(spec.typeName, spec.fieldName))),
    );
  }
  const unusedExpandContracts = expandContractFlags.filter(
    (flag) => !matchedExpandContractFlags.has(flag),
  );
  if (unusedExpandContracts.length > 0) {
    throw new Error(
      `--expand-contract does not match a field whose type changed: ${unusedExpandContracts
        .map((flag) => flag.raw)
        .join(", ")}`,
    );
  }

  // Resolve renames for every namespace before any migration file is written,
  // so all candidates are reported in one run and an abort (a decline, an
  // unresolved candidate, or an invalid spec in a later namespace) leaves no
  // namespace partially generated. compareSnapshots validates the specs.
  const unresolvedCandidates: UnresolvedRenameCandidate[] = [];
  for (const generation of generations) {
    const { namespace, previousSnapshot, currentSnapshot } = generation;
    if (!previousSnapshot) continue;
    const diff = compareSnapshots(previousSnapshot, currentSnapshot);
    if (!hasChanges(diff)) {
      generation.diff = diff;
      continue;
    }
    const resolution = await resolveFieldRenames(
      previousSnapshot,
      currentSnapshot,
      diff,
      options,
      renameSpecsByNamespace.get(namespace) ?? [],
      dropSpecsByNamespace.get(namespace) ?? [],
    );
    generation.diff = resolution.diff;
    unresolvedCandidates.push(...resolution.unresolved);
    generation.expandPlans = await resolveExpandContractPlans({
      previousSnapshot,
      currentSnapshot,
      diff: resolution.diff,
      options,
      confirmedKeys: expandContractKeysByNamespace.get(namespace) ?? new Set(),
    });
  }

  // Failing beats warning here: a candidate left unresolved in a
  // non-interactive run would be written as remove + add and silently drop
  // the field's data at deploy
  if (unresolvedCandidates.length > 0) {
    const details = unresolvedCandidates
      .map(
        ({ namespace, candidate, targets }) =>
          `  - ${candidate.typeName}.${candidate.removed.fieldName} → ${targets.join(", ")}? (namespace: ${namespace})`,
      )
      .join("\n");
    throw new Error(
      `Possible field rename(s) detected:\n${details}\n` +
        'Re-run with --rename "Type.oldField:newField" to record a rename and scaffold a data copy script, ' +
        'or --drop "Type.field" to confirm the removal.',
    );
  }

  for (const {
    migrationsDir,
    currentSnapshot,
    previousSnapshot,
    diff,
    expandPlans,
  } of generations) {
    if (!previousSnapshot) {
      // First migration - generate initial schema snapshot
      await generateInitialSnapshot(currentSnapshot, migrationsDir);
    } else {
      await generateDiffFromSnapshot(
        previousSnapshot,
        assertDefined(diff, "Migration diff was not resolved during preflight"),
        migrationsDir,
        options,
        currentSnapshot,
        expandPlans ?? [],
      );
    }
  }
}

/** Inputs for {@link resolveExpandContractPlans}. */
interface ResolveExpandContractOptions {
  previousSnapshot: NormalizedSchemaSnapshot;
  currentSnapshot: NormalizedSchemaSnapshot;
  diff: MigrationDiff;
  options: GenerateOptions;
  confirmedKeys: ReadonlySet<string>;
}

/**
 * Decide which unsupported field type changes to carry through a migration
 * pair, asking about each one that was not already named by a flag.
 * @param input - Snapshots, diff, command options, and flag-approved fields
 * @returns Approved plans, empty when nothing was confirmed
 */
async function resolveExpandContractPlans(
  input: ResolveExpandContractOptions,
): Promise<ExpandContractPlan[]> {
  const { previousSnapshot, currentSnapshot, diff, options, confirmedKeys } = input;
  const confirmed = new Set(confirmedKeys);

  if (!options.yes && canPrompt()) {
    for (const change of diff.changes) {
      if (change.kind !== "field_type_modified") continue;
      const key = fieldKey(change.typeName, change.fieldName);
      if (confirmed.has(key)) continue;
      if (!supportsExpandContractFieldChange(change.before, change.after)) continue;

      logger.newline();
      logger.info(
        `${change.typeName}.${change.fieldName} changes from ${change.before.type} to ${change.after.type}, which cannot be applied in one step.`,
      );
      const approved = await prompt.confirm({
        message: `Generate two migrations to convert ${change.typeName}.${change.fieldName} through a temporary field?`,
        default: true,
      });
      if (approved) confirmed.add(key);
    }
  }

  return planExpandContract({
    previous: previousSnapshot,
    current: currentSnapshot,
    diff,
    confirmed,
  }).plans;
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

/** A parsed `--rename` flag together with its raw value. */
interface RenameFlag {
  raw: string;
  spec: FieldRenameSpec;
}

/** A parsed `--drop` flag together with its raw value. */
interface DropFlag {
  raw: string;
  spec: FieldDropSpec;
}

/** A parsed `--expand-contract` flag together with its raw value. */
interface ExpandContractFlag {
  raw: string;
  spec: FieldExpandContractSpec;
}

/** Snapshots collected for one namespace before any migration file is written. */
interface NamespaceGeneration {
  namespace: string;
  migrationsDir: string;
  currentSnapshot: NormalizedSchemaSnapshot;
  previousSnapshot: NormalizedSchemaSnapshot | null;
  /** Diff with confirmed renames, set during preflight when a previous snapshot exists. */
  diff?: MigrationDiff;
  /** Field type changes confirmed for a migration pair during preflight. */
  expandPlans?: ExpandContractPlan[];
}

/** A rename candidate that a non-interactive run could not resolve. */
interface UnresolvedRenameCandidate {
  namespace: string;
  candidate: FieldRenameCandidate;
  targets: string[];
}

/** The outcome of resolving one namespace's rename candidates. */
interface RenameResolution {
  diff: MigrationDiff;
  unresolved: UnresolvedRenameCandidate[];
}

function availableRenameTargets(
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
 * Resolve field renames for a diff: apply `--rename` flags, skip candidates
 * whose removal is confirmed by `--drop`, confirm the rest interactively, and
 * recompute the diff with the confirmed renames. When prompting is
 * unavailable (`--yes` or no TTY), the remaining candidates are returned as
 * unresolved for the caller to fail on.
 * @param {NormalizedSchemaSnapshot} previousSnapshot - Previous normalized schema snapshot
 * @param {NormalizedSchemaSnapshot} currentSnapshot - Current normalized schema snapshot
 * @param {MigrationDiff} diff - Diff computed without rename knowledge
 * @param {GenerateOptions} options - Generate options
 * @param {readonly FieldRenameSpec[]} flagRenameSpecs - This namespace's `--rename` specs
 * @param {readonly FieldDropSpec[]} flagDropSpecs - This namespace's `--drop` specs
 * @returns {Promise<RenameResolution>} Diff with confirmed renames and any unresolved candidates
 */
async function resolveFieldRenames(
  previousSnapshot: NormalizedSchemaSnapshot,
  currentSnapshot: NormalizedSchemaSnapshot,
  diff: MigrationDiff,
  options: GenerateOptions,
  flagRenameSpecs: readonly FieldRenameSpec[],
  flagDropSpecs: readonly FieldDropSpec[],
): Promise<RenameResolution> {
  const confirmed: FieldRenameSpec[] = [...flagRenameSpecs];
  const claimedFields = new Set(
    confirmed.flatMap((spec) => [
      `${spec.typeName}.${spec.previousFieldName}`,
      `${spec.typeName}.${spec.fieldName}`,
    ]),
  );
  const droppedFields = new Set(flagDropSpecs.map((spec) => `${spec.typeName}.${spec.fieldName}`));

  const candidates = findRenameCandidates(diff).filter(
    (candidate) =>
      !droppedFields.has(`${candidate.typeName}.${candidate.removed.fieldName}`) &&
      !claimedFields.has(`${candidate.typeName}.${candidate.removed.fieldName}`) &&
      availableRenameTargets(candidate, claimedFields).length > 0,
  );

  const unresolved: UnresolvedRenameCandidate[] = [];
  if (options.yes || !canPrompt()) {
    for (const candidate of candidates) {
      unresolved.push({
        namespace: diff.namespace,
        candidate,
        targets: availableRenameTargets(candidate, claimedFields),
      });
    }
  } else {
    for (const candidate of candidates) {
      const addedFieldNames = availableRenameTargets(candidate, claimedFields);
      if (addedFieldNames.length === 0) continue;
      const newFieldName = await promptRenameCandidate(candidate, addedFieldNames);
      if (newFieldName) {
        confirmed.push({
          typeName: candidate.typeName,
          previousFieldName: candidate.removed.fieldName,
          fieldName: newFieldName,
        });
        claimedFields.add(`${candidate.typeName}.${candidate.removed.fieldName}`);
        claimedFields.add(`${candidate.typeName}.${newFieldName}`);
      }
    }
  }

  if (confirmed.length === 0) return { diff, unresolved };
  return {
    diff: compareSnapshots(previousSnapshot, currentSnapshot, { fieldRenames: confirmed }),
    unresolved,
  };
}

/**
 * Generate migration files from a diff resolved during preflight
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {MigrationDiff} diff - Diff with confirmed renames recorded
 * @param {string} migrationsDir - Migrations directory path
 * @param {GenerateOptions} options - Generate options
 * @param currentSnapshot - Schema the user now declares
 * @param expandPlans - Field changes confirmed for a migration pair
 * @returns {Promise<void>} Promise that resolves when diff is generated
 */
async function generateDiffFromSnapshot(
  previousSnapshot: NormalizedSchemaSnapshot,
  diff: MigrationDiff,
  migrationsDir: string,
  options: GenerateOptions,
  currentSnapshot: NormalizedSchemaSnapshot,
  expandPlans: readonly ExpandContractPlan[] = [],
): Promise<void> {
  if (!hasChanges(diff)) {
    logger.info("No schema differences detected.");
    return;
  }

  // Display diff
  logger.newline();
  logger.log(formatMigrationDiff(diff));
  logger.newline();
  logger.info(`Summary: ${formatDiffSummary(diff)}`);

  const plannedKeys = new Set(expandPlans.map((plan) => fieldKey(plan.typeName, plan.fieldName)));
  const unsupportedChanges = diff.breakingChanges.filter(
    (change) =>
      change.unsupported &&
      !(change.fieldName && plannedKeys.has(fieldKey(change.typeName, change.fieldName))),
  );
  if (unsupportedChanges.length > 0) {
    for (const change of unsupportedChanges) {
      logger.newline();
      logger.error(`Unsupported change: ${change.typeName}.${change.fieldName}`);
      logger.error(`  ${change.reason}`);
    }

    const convertible = unsupportedChanges.filter(({ typeName, fieldName }) => {
      if (!fieldName) return false;
      const before = previousSnapshot.types[typeName]?.fields[fieldName];
      const after = currentSnapshot.types[typeName]?.fields[fieldName];
      return Boolean(before && after && supportsExpandContractFieldChange(before, after));
    });
    if (convertible.length > 0) {
      logger.newline();
      logger.info("Convert these fields through a temporary field with:");
      for (const { typeName, fieldName } of convertible) {
        logger.info(`  --expand-contract "${typeName}.${fieldName}"`);
      }
    }

    // Show 3-step migration hint if any unsupported change requires it
    if (unsupportedChanges.some((change) => change.showThreeStepHint)) {
      logger.newline();
      for (const line of getUnsupportedMigrationHintLines()) {
        logger.info(line);
      }
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

  if (expandPlans.length > 0) {
    await generateExpandContractMigrations({
      previousSnapshot,
      currentSnapshot,
      plans: expandPlans,
      migrationsDir,
      description: options.name,
    });
    return;
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
    `Generated migration ${styles.bold(formatMigrationNumber(result.migrationNumber))}`,
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
    await acknowledgeWarnings({
      namespace: diff.namespace,
      migrationsDir,
      migrationNumber: result.migrationNumber,
      skipPrompt: options.yes,
      configPath: options.configPath,
    });
  }
}

/** Inputs for {@link generateExpandContractMigrations}. */
interface GenerateExpandContractOptions {
  previousSnapshot: NormalizedSchemaSnapshot;
  currentSnapshot: NormalizedSchemaSnapshot;
  plans: readonly ExpandContractPlan[];
  migrationsDir: string;
  description?: string;
}

/**
 * Write the two migrations that carry a field type change: one that converts
 * values into a temporary field, and one that renames it back.
 * @param input - Snapshots, confirmed plans, and output location
 * @returns {Promise<void>} Promise that resolves when both migrations are written
 */
async function generateExpandContractMigrations(
  input: GenerateExpandContractOptions,
): Promise<void> {
  const { previousSnapshot, currentSnapshot, plans, migrationsDir, description } = input;
  const intermediateSnapshot = buildIntermediateSnapshot(previousSnapshot, plans);
  const expandDiff = compareSnapshots(previousSnapshot, intermediateSnapshot);
  const contractDiff = compareSnapshots(intermediateSnapshot, currentSnapshot, {
    fieldRenames: plans.map((plan) => ({
      typeName: plan.typeName,
      previousFieldName: plan.tempFieldName,
      fieldName: plan.fieldName,
    })),
  });

  const expandNumber = getNextMigrationNumber(migrationsDir);
  const expand = await generateDiffFiles(
    expandDiff,
    migrationsDir,
    expandNumber,
    previousSnapshot,
    description,
    plans,
  );
  const contract = await generateDiffFiles(
    contractDiff,
    migrationsDir,
    expandNumber + 1,
    intermediateSnapshot,
    description,
  );

  const fields = plans.map((plan) => `${plan.typeName}.${plan.fieldName}`).join(", ");
  logger.success(
    `Generated migrations ${styles.bold(formatMigrationNumber(expand.migrationNumber))} and ${styles.bold(
      formatMigrationNumber(contract.migrationNumber),
    )} to convert ${fields}`,
  );
  if (expand.migrateFilePath) {
    logger.info(`  Conversion script: ${expand.migrateFilePath}`);
  }
  if (contract.migrateFilePath) {
    logger.info(`  Copy script: ${contract.migrateFilePath}`);
  }
  logger.newline();
  logger.log(
    `Edit the conversion in ${formatMigrationNumber(expand.migrationNumber)} before deploying; the second migration needs no changes.`,
  );
  logger.log("Both migrations are applied by 'tailor deploy'.");
}

interface AcknowledgeWarningsOptions {
  namespace: string;
  migrationsDir: string;
  migrationNumber: number;
  skipPrompt?: boolean;
  configPath?: string;
}

/**
 * Offer to record a --no-script acknowledgment for a warning-only migration,
 * or print the follow-up commands when the session is non-interactive
 * @param {AcknowledgeWarningsOptions} options - Target migration and prompt behavior
 */
async function acknowledgeWarnings(options: AcknowledgeWarningsOptions): Promise<void> {
  const { namespace, migrationsDir, migrationNumber, skipPrompt, configPath } = options;
  const label = formatMigrationNumber(migrationNumber);

  logger.newline();
  logger.log("Data loss is possible for this migration but no script was generated.");

  if (!skipPrompt && canPrompt()) {
    const record = await prompt.confirm({
      message: "Record a reason acknowledging that this migration intentionally has no script?",
      default: true,
    });
    if (record) {
      const reason = await prompt.text({
        message: "Reason:",
        validate: (value) => value.trim() !== "" || "Reason must not be empty.",
      });
      const scriptSkipped = markMigrationScriptSkipped({ migrationsDir, migrationNumber, reason });
      logger.success(
        `Recorded that migration ${styles.bold(label)} intentionally has no migration script`,
      );
      logger.info(`  Reason: ${scriptSkipped.reason}`);
      return;
    }
  }

  const commandOptions = { migrationNumber, namespace, configPath };
  logger.log("To add a custom migrate.ts, run:");
  logger.log(`  ${styles.bold(formatMigrationScriptCommand(commandOptions))}`);
  logger.log("To record that this migration intentionally has no script, run:");
  logger.log(
    `  ${styles.bold(formatMigrationScriptCommand({ ...commandOptions, noScript: true }))}`,
  );
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
    drop: arg(z.array(z.string()).optional(), {
      description:
        'Confirm that a removed field is a genuine removal, not a rename (format: "Type.field"; repeatable). Required in non-interactive runs for a removed field with rename candidates.',
    }),
    "expand-contract": arg(z.array(z.string()).optional(), {
      description:
        'Convert a field type through a temporary field (format: "Type.field"; repeatable). Generates two migrations.',
    }),
  }),
  run: async (args) => {
    await generate({
      configPath: args.config,
      name: args.name,
      yes: args.yes,
      init: args.init,
      renames: args.rename,
      drops: args.drop,
      expandContracts: args["expand-contract"],
    });
  },
});

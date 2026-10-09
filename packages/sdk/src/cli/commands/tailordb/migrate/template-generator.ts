/**
 * Template generator for TailorDB migrations
 *
 * Generates migration files in directory structure:
 * - XXXX/schema.json - Full schema snapshot (initial migration 0000)
 * - XXXX/diff.json - Schema diff (subsequent migrations 0001+)
 * - XXXX/migrate.ts - Data migration script (when breaking changes exist)
 * - XXXX/db.ts - Generated types for migration script
 * - XXXX/db.pglite.ts - PGlite schema script for testing the migration script
 */

import * as fs from "node:fs/promises";
import { CLIError } from "#/cli/shared/errors";
import { isMigrationStepName } from "#/utils/migration-steps";
import { formatFieldShape, isSingleValueToArrayChange } from "./field-type-change";
import { writeMigrationTypeFiles } from "./pglite-schema-generator";
import { isBreakingForeignKeyRetarget } from "./rename-detection";
import {
  DEFAULT_DECIMAL_SCALE,
  getMigrationDirPath,
  getMigrationFilePath,
  isBreakingIndexChange,
  type SchemaSnapshot,
} from "./snapshot";
import type { EffectiveDateDefault } from "#/runtime/types";
import type {
  MigrationDiff,
  DiffChange,
  FieldModifiedChange,
  FieldRenamedChange,
  TableRenamedChange,
} from "./diff-calculator";
import type { ExpandContractPlan } from "./expand-contract";
import type { MigrationScriptForm } from "./script-form";

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a file does not already exist, throwing an error if it does
 * @param {string} filePath - Path to check
 * @throws {Error} If file already exists
 */
async function ensureFileNotExists(filePath: string): Promise<void> {
  if (await fileExists(filePath)) {
    throw CLIError({
      code: "MIGRATION_FILE_EXISTS",
      message: `Migration file already exists: ${filePath}`,
    });
  }
}

interface GenerateSchemaResult {
  filePath: string;
  migrationNumber: number;
}

interface GenerateDiffResult {
  diffFilePath: string;
  migrateFilePath?: string;
  dbTypesFilePath?: string;
  /** Written with db.ts unless the schema cannot be expressed as DDL; see `pgliteSchemaError`. */
  pgliteSchemaFilePath?: string;
  /** Why db.pglite.ts was skipped */
  pgliteSchemaError?: string;
  migrationNumber: number;
}

/**
 * Generate the initial schema snapshot file
 * @param {SchemaSnapshot} snapshot - Schema snapshot to save
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @returns {Promise<GenerateSchemaResult>} Generated file info
 */
export async function generateSchemaFile(
  snapshot: SchemaSnapshot,
  migrationsDir: string,
  migrationNumber: number,
): Promise<GenerateSchemaResult> {
  // Create migration directory
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "schema");

  // Check if file already exists to prevent accidental overwrite
  await ensureFileNotExists(filePath);

  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));

  return {
    filePath,
    migrationNumber,
  };
}

/**
 * Generate diff and optional migration script files
 * @param {MigrationDiff} diff - Migration diff to save
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot (for db.ts generation)
 * @param {string} [description] - Optional description for the migration
 * @param expandPlans - Field changes carried through temporary fields
 * @param temporal - Whether date/datetime/time fields in db.ts resolve to their Temporal
 * column types instead of their `Date`/`string` defaults. Should match whatever
 * `kyselyTypePlugin` was configured with. Defaults to `false`.
 * @param dateDefault - Representation applied to `t` date fields that omit `as`; recorded in `diff.json`
 * @param finishedExpansions - Conversions whose temporary field this migration renames back; every row already holds a value there
 * @returns {Promise<GenerateDiffResult>} Generated file info
 */
export async function generateDiffFiles(
  diff: MigrationDiff,
  migrationsDir: string,
  migrationNumber: number,
  previousSnapshot: SchemaSnapshot,
  description?: string,
  expandPlans: readonly ExpandContractPlan[] = [],
  temporal = false,
  dateDefault: EffectiveDateDefault = "legacy",
  finishedExpansions: readonly ExpandContractPlan[] = [],
): Promise<GenerateDiffResult> {
  // Create migration directory
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  // Build file paths
  const diffFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  const migrateFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  const dbTypesFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");
  const pgliteSchemaFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "pgliteSchema");

  const writeScript = diff.requiresMigrationScript;

  // Check if files already exist to prevent accidental overwrite
  await ensureFileNotExists(diffFilePath);
  if (writeScript) {
    await ensureFileNotExists(migrateFilePath);
    await ensureFileNotExists(dbTypesFilePath);
    await ensureFileNotExists(pgliteSchemaFilePath);
  }

  // Add description if provided
  const diffWithDescription = description ? { ...diff, description } : diff;

  // Write diff file
  await fs.writeFile(diffFilePath, JSON.stringify(diffWithDescription, null, 2));

  const result: GenerateDiffResult = {
    diffFilePath,
    migrationNumber,
  };

  if (writeScript) {
    const scriptContent = generateMigrationScript(
      diffWithDescription,
      expandPlans,
      finishedExpansions,
    );
    await fs.writeFile(migrateFilePath, scriptContent);
    result.migrateFilePath = migrateFilePath;

    // Generate db.ts with types based on the PREVIOUS schema state
    // (the state before this migration runs)
    // Pass diff to generate ColumnType for optional->required fields
    const typeFiles = await writeMigrationTypeFiles({
      previousSnapshot,
      diff: diffWithDescription,
      migrationsDir,
      migrationNumber,
      expandPlans,
      temporal,
      dateDefault,
    });
    result.dbTypesFilePath = typeFiles.dbTypesPath;
    result.pgliteSchemaFilePath = typeFiles.pgliteSchemaPath;
    result.pgliteSchemaError = typeFiles.pgliteSchemaError;
  }

  return result;
}

/** Inputs for {@link generateDataOnlyMigrationFiles}. */
interface GenerateDataOnlyFilesOptions {
  /** Empty diff marked as requiring a migration script. */
  diff: MigrationDiff;
  migrationsDir: string;
  migrationNumber: number;
  /** Schema the migration runs against, used for db.ts generation. */
  snapshot: SchemaSnapshot;
  description?: string;
  /**
   * Whether date/datetime/time fields in db.ts resolve to their Temporal column types
   * instead of their `Date`/`string` defaults. Should match whatever `kyselyTypePlugin`
   * was configured with. Defaults to `false`.
   */
  temporal?: boolean;
  /** Representation applied to `t` date fields that omit `as`; recorded in `diff.json`. */
  dateDefault?: EffectiveDateDefault;
}

/** Files written for a data-only migration. */
interface GenerateDataOnlyFilesResult {
  diffFilePath: string;
  migrateFilePath: string;
  dbTypesFilePath: string;
  /** Written with db.ts unless the schema cannot be expressed as DDL; see `pgliteSchemaError`. */
  pgliteSchemaFilePath?: string;
  /** Why db.pglite.ts was skipped */
  pgliteSchemaError?: string;
  migrationNumber: number;
}

/**
 * Generate the files for a data-only migration: an empty diff and a migration
 * script skeleton typed against the unchanged schema.
 * @param {GenerateDataOnlyFilesOptions} options - Diff, output location, and schema for db.ts
 * @returns {Promise<GenerateDataOnlyFilesResult>} Generated file info
 */
export async function generateDataOnlyMigrationFiles(
  options: GenerateDataOnlyFilesOptions,
): Promise<GenerateDataOnlyFilesResult> {
  const {
    migrationsDir,
    migrationNumber,
    snapshot,
    description,
    temporal = false,
    dateDefault = "legacy",
  } = options;
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  const diffFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  const migrateFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  const dbTypesFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");

  await ensureFileNotExists(diffFilePath);
  await ensureFileNotExists(migrateFilePath);
  await ensureFileNotExists(dbTypesFilePath);
  await ensureFileNotExists(getMigrationFilePath(migrationsDir, migrationNumber, "pgliteSchema"));

  const diff = description ? { ...options.diff, description } : options.diff;
  await fs.writeFile(diffFilePath, JSON.stringify(diff, null, 2));
  await fs.writeFile(migrateFilePath, generateDataOnlyMigrationScript(diff.namespace));
  const typeFiles = await writeMigrationTypeFiles({
    previousSnapshot: snapshot,
    diff,
    migrationsDir,
    migrationNumber,
    temporal,
    dateDefault,
  });

  return {
    diffFilePath,
    migrateFilePath,
    dbTypesFilePath,
    pgliteSchemaFilePath: typeFiles.pgliteSchemaPath,
    pgliteSchemaError: typeFiles.pgliteSchemaError,
    migrationNumber,
  };
}

/**
 * Generate the script skeleton for a data-only migration
 * @param {string} namespace - TailorDB namespace the migration belongs to
 * @returns {string} Migration script content
 */
function generateDataOnlyMigrationScript(namespace: string): string {
  return `/**
 * Data-only migration script for ${namespace}
 *
 * This migration carries no schema change; it exists to run this script.
 * Edit this file to implement the data transformation.
 *
${scriptNotes()}
 */

${renderScript('  void TODO("implement the data transformation for this migration");', "")}`;
}

/**
 * Header lines describing how the steps of the script run
 * @returns Comment lines, each starting with ` *`
 */
function scriptNotes(): string {
  return ` * A script with one step runs like \`main\`, in one transaction. Once it has several
 * steps, each runs in its own transaction and commits on its own, and a deploy that
 * fails after a step committed resumes from the steps that have not completed, so
 * write every step to be safe to run again. Split a step into several steps
 * where the work divides, and order them with \`dependsOn\`.
 * See "Splitting a migration into steps" in the TailorDB migration docs.`;
}

/** A step of a generated `steps` script: one schema change and the earlier steps it must follow. */
interface ScriptStep {
  name: string;
  body: string;
  dependsOn: readonly string[];
  /** The step rewrites values that already exist, which a rollback does not bring back. */
  overwritesExistingValues?: boolean;
}

/** A field a step reads or writes; `ALL_FIELDS` stands for every field of the table. */
interface FieldTouch {
  table: string;
  field: string;
}

const ALL_FIELDS = "*";

/** Functions a generated script declares next to its steps, whose names a step function must not take. */
const RESERVED_FUNCTION_NAMES = ["renameNestedMember"];

const NO_DATA_MIGRATION_BODY = `  // No data migration needed for this schema change
  // Add custom data transformations if required`;

const OVERWRITE_NOTE = `// Overwrites existing values. Once this step commits it cannot be undone,
// so check the values it writes before you deploy.
`;

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The tables other than itself that the fields of a table point to.
 * @param fields - Fields of the table
 * @param tableName - Name of the table, whose self-references are not a dependency
 * @returns Names of the referenced tables
 */
function foreignKeyTargets(
  fields: Readonly<Record<string, { foreignKeyType?: string }>>,
  tableName: string,
): string[] {
  return [
    ...new Set(
      Object.values(fields)
        .map((field) => field.foreignKeyType)
        .filter((target): target is string => target !== undefined && target !== tableName),
    ),
  ];
}

/**
 * The renamed tables a renamed table references whose copies run after its own, which happens
 * when the renamed tables reference each other and no order lets every copy find its parents.
 * @param change - Table rename to check
 * @param later - Changes that run after it
 * @returns The referenced tables that are copied later
 */
function copiedLater(change: TableRenamedChange, later: readonly DiffChange[]): string[] {
  const names = new Set(
    later.flatMap((candidate) => (candidate.kind === "table_renamed" ? [candidate.tableName] : [])),
  );
  return foreignKeyTargets(change.after.fields, change.tableName).filter((target) =>
    names.has(target),
  );
}

function cycleCopyTodo(change: TableRenamedChange, parents: readonly string[]): string {
  const list = parents.join(", ");
  const message =
    parents.length === 1
      ? `copy ${change.tableName} with the foreign key to ${list} set to null, then fill it in after the copy of ${list}`
      : `copy ${change.tableName} with its foreign keys to ${list} set to null, then fill them in after the copies of ${list}`;
  return `  // ${change.tableName} and ${list} reference each other, so neither copy can find the rows its foreign key points to.
  void TODO(${JSON.stringify(message)});`;
}

/**
 * Put the renamed tables a renamed table references before it, so its copy finds the
 * rows its foreign keys point to. The renames keep their slots among the other changes
 * and the order they were listed in, apart from that; a cycle keeps the listed order.
 * @param changes - Changes in the order they were listed
 * @returns The same changes with the table renames ordered by their references
 */
function orderTableRenames(changes: readonly DiffChange[]): DiffChange[] {
  const remaining = changes.filter(
    (change): change is TableRenamedChange => change.kind === "table_renamed",
  );
  const parentsOf = (rename: TableRenamedChange): Set<string> =>
    new Set(
      foreignKeyTargets(rename.after.fields, rename.tableName).filter((target) =>
        remaining.some((candidate) => candidate.tableName === target),
      ),
    );
  const ordered: TableRenamedChange[] = [];
  while (remaining.length > 0) {
    const copied = new Set(ordered.map((rename) => rename.tableName));
    const index = remaining.findIndex((rename) =>
      [...parentsOf(rename)].every((p) => copied.has(p)),
    );
    ordered.push(...remaining.splice(Math.max(index, 0), 1));
  }
  let next = 0;
  return changes.map((change) =>
    change.kind === "table_renamed" ? (ordered[next++] ?? change) : change,
  );
}

/**
 * Name the step for a change and list the fields it reads or writes. Two steps
 * that touch the same field must run in the order the changes are listed; steps that
 * touch different fields do not depend on each other.
 * @param change - Diff change to describe
 * @returns Preferred step name and the fields the change touches
 */
function describeChange(change: DiffChange): { preferredName: string; touches: FieldTouch[] } {
  const table = capitalize(change.tableName);
  switch (change.kind) {
    case "field_added":
      return {
        preferredName: `populate${table}${capitalize(change.fieldName)}`,
        touches: [{ table: change.tableName, field: change.fieldName }],
      };
    case "field_renamed":
      return {
        preferredName: `rename${table}${capitalize(change.fieldName)}`,
        touches: [
          { table: change.tableName, field: change.previousFieldName },
          { table: change.tableName, field: change.fieldName },
        ],
      };
    case "table_renamed":
      return {
        preferredName: `copy${capitalize(change.previousTableName)}To${table}`,
        touches: [
          { table: change.previousTableName, field: ALL_FIELDS },
          { table: change.tableName, field: ALL_FIELDS },
          ...foreignKeyTargets(change.after.fields, change.tableName).map((target) => ({
            table: target,
            field: "id",
          })),
        ],
      };
    case "field_modified":
    case "field_type_modified": {
      const target = change.after.foreignKeyType;
      return {
        preferredName: `update${table}${capitalize(change.fieldName)}`,
        touches: [
          { table: change.tableName, field: change.fieldName },
          ...(target && target !== change.before.foreignKeyType
            ? [{ table: target, field: "id" }]
            : []),
        ],
      };
    }
    case "index_added":
    case "index_modified":
      return {
        preferredName: `resolve${table}${capitalize(change.indexName)}`,
        touches: change.after.fields.map((field) => ({ table: change.tableName, field })),
      };
    default:
      return { preferredName: "", touches: [{ table: change.tableName, field: ALL_FIELDS }] };
  }
}

/**
 * Whether the statements of a change rewrite values that already exist. Steps
 * that only fill columns or tables the Pre-phase added, or only add members
 * next to the old ones, leave the original values in place.
 * @param change - Diff change the statements were generated for
 * @param statementCount - Number of statements generated for the change
 * @returns True when the step overwrites existing values
 */
function overwritesExistingValues(change: DiffChange, statementCount: number): boolean {
  switch (change.kind) {
    case "index_added":
    case "index_modified":
    case "field_type_modified":
      return true;
    case "field_modified":
      return !(change.memberRenames?.length && statementCount === 1);
    default:
      return false;
  }
}

const touchesOverlap = (a: readonly FieldTouch[], b: readonly FieldTouch[]): boolean =>
  a.some((x) =>
    b.some(
      (y) =>
        x.table === y.table &&
        (x.field === ALL_FIELDS || y.field === ALL_FIELDS || x.field === y.field),
    ),
  );

/**
 * The statements of one change, in the order they must run.
 * @param change - Diff change to generate statements for
 * @param typeRenameTargets - Confirmed type renames (old name → new name)
 * @param finishedExpansions - Conversions whose temporary field this migration renames back
 * @returns Statements, or an empty array when the change needs no data migration
 */
function generateChangeStatements(
  change: DiffChange,
  typeRenameTargets: ReadonlyMap<string, string>,
  finishedExpansions: readonly ExpandContractPlan[],
): string[] {
  const decimalScaleScript = generateDecimalScaleChangeScript(change);
  const statements = generateChangeScripts(
    change,
    decimalScaleScript !== null,
    typeRenameTargets,
    finishedExpansions,
  );
  if (decimalScaleScript) {
    statements.push(decimalScaleScript);

    const uniqueConstraintScript = generateUniqueConstraintScript(change);
    if (uniqueConstraintScript) {
      statements.push(uniqueConstraintScript);
    }
  }
  return statements;
}

/**
 * Split a migration into one step per change that needs a data migration. A
 * step depends on every earlier step that touches the same field, so the
 * order the changes are listed in stays the order the steps run in. A step
 * can also be skipped on a re-run, because each one commits on its own.
 * @param diff - Migration diff
 * @param expandPlans - Field changes carried through temporary fields
 * @param typeRenameTargets - Confirmed type renames (old name → new name)
 * @param finishedExpansions - Conversions whose temporary field this migration renames back
 * @returns Steps in the order of the changes
 */
function buildScriptSteps(
  diff: MigrationDiff,
  expandPlans: readonly ExpandContractPlan[],
  typeRenameTargets: ReadonlyMap<string, string>,
  finishedExpansions: readonly ExpandContractPlan[],
): ScriptStep[] {
  interface Draft {
    preferredName: string;
    fallbackName: string;
    body: string;
    touches: readonly FieldTouch[];
    overwritesExistingValues: boolean;
  }
  const drafts: Draft[] = expandPlans.map((plan, index) => ({
    preferredName: `convert${capitalize(plan.tableName)}${capitalize(plan.fieldName)}`,
    fallbackName: `expand${index + 1}`,
    body: generateExpandConversionScript(plan),
    overwritesExistingValues: true,
    touches: [
      { table: plan.tableName, field: plan.fieldName },
      { table: plan.tableName, field: plan.tempFieldName },
    ],
  }));
  const orderedChanges = orderTableRenames(diff.changes);
  orderedChanges.forEach((change, index) => {
    const statements = generateChangeStatements(change, typeRenameTargets, finishedExpansions);
    if (statements.length === 0) return;
    if (change.kind === "table_renamed") {
      const cycle = copiedLater(change, orderedChanges.slice(index + 1));
      if (cycle.length > 0) statements.unshift(cycleCopyTodo(change, cycle));
    }
    const { preferredName, touches } = describeChange(change);
    drafts.push({
      preferredName,
      fallbackName: `change${index + 1}`,
      body: [...statements].join("\n\n"),
      touches,
      overwritesExistingValues: overwritesExistingValues(change, statements.length),
    });
  });

  const usedNames = new Set<string>(RESERVED_FUNCTION_NAMES);
  const earlier: { name: string; touches: readonly FieldTouch[] }[] = [];
  return drafts.map((draft) => {
    const name =
      isMigrationStepName(draft.preferredName) && !usedNames.has(draft.preferredName)
        ? draft.preferredName
        : draft.fallbackName;
    usedNames.add(name);
    const dependsOn = earlier
      .filter((step) => touchesOverlap(step.touches, draft.touches))
      .map((step) => step.name);
    earlier.push({ name, touches: draft.touches });
    return {
      name,
      body: draft.body,
      dependsOn,
      overwritesExistingValues: draft.overwritesExistingValues,
    };
  });
}

/**
 * Render the imports and the exported steps of a migration script
 * @param body - Statements of the migration, held by a single `migrate` step when there are no steps
 * @param helpers - Helper declarations placed between the import and the steps
 * @param steps - Steps of the script, one per change that needs a data migration
 * @returns Script source after the header comment
 */
function renderScript(body: string, helpers: string, steps: readonly ScriptStep[] = []): string {
  const units: readonly ScriptStep[] =
    steps.length > 0 ? steps : [{ name: "migrate", body, dependsOn: [] }];
  const functions = units
    .map(
      (
        unit,
      ) => `${unit.overwritesExistingValues ? OVERWRITE_NOTE : ""}async function ${unit.name}(trx: Transaction): Promise<void> {
${unit.body}
}`,
    )
    .join("\n\n");
  const entries = units
    .map((unit) => {
      const dependsOn =
        unit.dependsOn.length > 0 ? `dependsOn: ${JSON.stringify(unit.dependsOn)}, ` : "";
      return `  ${unit.name}: { ${dependsOn}run: ${unit.name} },`;
    })
    .join("\n");
  const dbImport = units.some((unit) => unit.body.includes("TODO("))
    ? 'import { TODO, type MigrationSteps, type Transaction } from "./db";'
    : 'import type { MigrationSteps, Transaction } from "./db";';
  return `${dbImport}
${helpers}
${functions}

export const steps = {
${entries}
} satisfies MigrationSteps;
`;
}

/**
 * Generate migration script content based on diff
 * @param {MigrationDiff} diff - Migration diff
 * @param expandPlans - Field changes carried through temporary fields
 * @param finishedExpansions - Conversions whose temporary field this migration renames back
 * @returns {string} Migration script content
 */
export function generateMigrationScript(
  diff: MigrationDiff,
  expandPlans: readonly ExpandContractPlan[] = [],
  finishedExpansions: readonly ExpandContractPlan[] = [],
): string {
  const typeRenameTargets = new Map(
    diff.changes
      .filter((change): change is TableRenamedChange => change.kind === "table_renamed")
      .map((change) => [change.previousTableName, change.tableName]),
  );

  const steps = buildScriptSteps(diff, expandPlans, typeRenameTargets, finishedExpansions);

  const helpers = diff.changes.some(
    (change) => change.kind === "field_modified" && change.memberRenames?.length,
  )
    ? `\n${NESTED_MEMBER_RENAME_HELPER}`
    : "";

  return `/**
 * Migration script for ${diff.namespace}
 *
 * This script runs between the Pre-migration and Post-migration phases of
 * 'tailor deploy'. Use it to transform existing data so that the schema
 * change can complete safely (for breaking changes, this is hard-required;
 * for warning-tier changes it is optional). Edit this file to implement
 * your data migration logic.
 *
${scriptNotes()}
 */

${renderScript(NO_DATA_MIGRATION_BODY, helpers, steps)}`;
}

// Emitted into both test scaffolds so the test runs the script with the values
// deploy gives it, as recorded in diff.json (string values when nothing is
// recorded), even after tailor.config.ts changes. The script is imported after
// the pin so that fields it parses at import time already follow it.
function dateRepresentationPin(diff: MigrationDiff, exportName: "main" | "steps"): string {
  const representation = diff.dateRepresentation ?? "string";
  const reason = diff.dateRepresentation
    ? `// diff.json records that this migration was generated under
// defaultDateRepresentation: ${JSON.stringify(representation)}, and deploy runs it that way.`
    : `// diff.json records no defaultDateRepresentation for this migration, so deploy
// runs it with string values whatever tailor.config.ts sets today.`;
  return `
${reason}
const restoreDateRepresentation = applyDateRepresentation(${JSON.stringify(representation)});
afterAll(restoreDateRepresentation);
const { ${exportName} } = await import("./migrate");
`;
}

/**
 * Generate migration test file content
 * @param {MigrationDiff} diff - Migration diff
 * @param scriptKind - Whether migrate.ts exports `main` or `steps`
 * @returns {string} Migration test file content
 */
export function generateMigrationTestScript(
  diff: MigrationDiff,
  scriptKind: MigrationScriptForm["kind"] = "main",
): string {
  const isSteps = scriptKind === "steps";
  const temporalDefault = diff.dateRepresentation === "temporal";
  return `/**
 * Unit test for the ${diff.namespace} migration script.
 *
 * The mock compiles queries to the same SQL as the deployed migration, so the
 * test verifies the exact statements migrate.ts issues. Stage the rows each
 * query returns, run ${isSteps ? "the steps, each in its own transaction," : "main() inside a transaction,"} then assert the executed
 * statements.${
   temporalDefault
     ? `
 *
 * Date fields declared with t that omit \`as\` carry Temporal values here, so run
 * this file in the tailor-runtime Vitest environment, which provides Temporal.`
     : ""
 }
 */

import { applyDateRepresentation, createKyselyMock${isSteps ? ", runMigrationSteps" : ""} } from "@tailor-platform/sdk/vitest";
import { afterAll, describe, expect, test } from "vitest";
import type { Database } from "./db";
${dateRepresentationPin(diff, isSteps ? "steps" : "main")}
describe(${JSON.stringify(`${diff.namespace} migration`)}, () => {
  test("issues the intended statements", async () => {
    const mock = createKyselyMock<Database>();

    // Stage the rows each query returns, in execution order:
    // mock.enqueueResult([{ id: "record-1" }]);

${
  isSteps
    ? `    // Pass env when your steps use it: runMigrationSteps(steps, { transaction, env: { ... } })
    await runMigrationSteps(steps, { transaction: (run) => mock.withTx(run) });
`
    : `    // Pass a MigrationContext when your main uses env: main(trx, { env: { ... } })
    await mock.withTx((trx) => main(trx));
`
}
    // Replace with assertions on the statements the script must issue:
    // expect(mock.updates).toHaveLength(1);
    // expect(mock.updates[0]?.updateValues()).toEqual({ field: "value" });
    expect(
      mock.executedQueries.map((query) => ({ sql: query.sql, parameters: query.parameters })),
    ).toMatchSnapshot();
  });
});
`;
}

/**
 * Generate the PGlite test file content
 * @param {MigrationDiff} diff - Migration diff
 * @param scriptKind - Whether migrate.ts exports `main` or `steps`
 * @returns {string} PGlite test file content
 */
export function generateMigrationPgliteTestScript(
  diff: MigrationDiff,
  scriptKind: MigrationScriptForm["kind"] = "main",
): string {
  const isSteps = scriptKind === "steps";
  const schema = /^[A-Za-z_$][\w$]*$/.test(diff.namespace)
    ? `pgliteSchema.${diff.namespace}`
    : `pgliteSchema[${JSON.stringify(diff.namespace)}]`;
  const temporalDefault = diff.dateRepresentation === "temporal";
  return `/**
 * PGlite test for the ${diff.namespace} migration script.
 *
 * The generated db.pglite.ts creates the tables as they stand while migrate.ts
 * runs, on an in-memory Postgres. Stage the rows the script converts, run
 * ${isSteps ? "the steps, each in its own transaction," : "main() inside a transaction,"} then assert the rows it leaves behind.${
   diff.temporal || temporalDefault
     ? `
 *
 * ${
   diff.temporal
     ? "Date, datetime, and time columns are Temporal values here"
     : "Date fields declared with t that omit `as` carry Temporal values here"
 }, so run this file
 * in the tailor-runtime Vitest environment, which provides Temporal.`
     : ""
 }
 */

import { PGlite } from "@electric-sql/pglite";
import { applyDateRepresentation, createKyselyPGlite${isSteps ? ", runMigrationSteps" : ""}, type Unmigrated } from "@tailor-platform/sdk/vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Database } from "./db";
import { pgliteSchema } from "./db.pglite";
${dateRepresentationPin(diff, isSteps ? "steps" : "main")}
const pglite = new PGlite();
const db = createKyselyPGlite<Unmigrated<Database>>(pglite${diff.temporal ? ", { temporal: true }" : ""});

// PGlite loads Postgres on first use, which can take longer than the default hook timeout.
beforeAll(async () => {
  await pglite.exec(${schema});
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe(${JSON.stringify(`${diff.namespace} migration (PGlite)`)}, () => {
  test("transforms the staged rows", async () => {
    // Stage the rows the script converts:
    // await db.insertInto("Table").values([{ field: "before" }]).execute();

${
  isSteps
    ? `    // Pass env when your steps use it: runMigrationSteps(steps, { transaction, env: { ... } })
    await runMigrationSteps(steps, { transaction: (run) => db.transaction().execute(run) });
`
    : `    // Pass a MigrationContext when your main uses env: main(trx, { env: { ... } })
    await expect(db.transaction().execute((trx) => main(trx))).resolves.toBeUndefined();
`
}
    // Add assertions on the rows the script leaves behind:
    // expect(await db.selectFrom("Table").selectAll().execute()).toEqual([{ field: "after" }]);
  });
});
`;
}

/**
 * Generate scripts for a single change
 * @param {DiffChange} change - Diff change to generate script for
 * @param {boolean} deferUniqueConstraint - Generate the unique check after decimal re-serialization
 * @param {ReadonlyMap<string, string>} [typeRenameTargets] - Confirmed type renames (old name → new name)
 * @param finishedExpansions - Conversions whose temporary field this migration renames back
 * @returns {string[]} Script contents, or an empty array if no script is needed
 */
function generateChangeScripts(
  change: DiffChange,
  deferUniqueConstraint = false,
  typeRenameTargets?: ReadonlyMap<string, string>,
  finishedExpansions: readonly ExpandContractPlan[] = [],
): string[] {
  if (change.kind === "index_added" || change.kind === "index_modified") {
    const before = change.kind === "index_modified" ? change.before : undefined;
    if (!isBreakingIndexChange(change.tableName, change.indexName, before, change.after)) {
      return [];
    }
    const fields = change.after.fields;
    const fieldList = fields.map((f) => `"${f}"`).join(", ");
    const whereClauses = fields.map((f) => `.where("${f}", "=", dup.${f})`).join("\n        ");
    return [
      `  // Resolve duplicate (${fields.join(", ")}) combinations before unique index "${change.indexName}" is enforced
  {
    const duplicates = await trx
      .selectFrom("${change.tableName}")
      .select([${fieldList}])
      .groupBy([${fieldList}])
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      const records = await trx
        .selectFrom("${change.tableName}")
        .select(["id"])
        ${whereClauses}
        .execute();
      // Keep the first record; update or delete the others so the combination becomes unique
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${change.tableName}")
          .set({ ${fields[0]}: TODO("set a unique ${change.tableName}.${fields[0]} value for the duplicates") })
          .where("id", "=", records[i].id)
          .execute();
      }
    }
  }`,
    ];
  }

  if (change.kind === "field_added") {
    const field = change.after;
    if (field.required) {
      return [
        `  // Populate ${change.fieldName} for existing ${change.tableName} records
  await trx
    .updateTable("${change.tableName}")
    .set({
      ${change.fieldName}: TODO("set the value ${change.tableName}.${change.fieldName} takes in existing records"),
    })
    .execute();`,
      ];
    }
    return [];
  }

  if (change.kind === "field_renamed") {
    const everyRowFilled = finishedExpansions.some(
      (plan) =>
        plan.tableName === change.tableName &&
        plan.tempFieldName === change.previousFieldName &&
        plan.fieldName === change.fieldName &&
        (plan.before.required || !plan.after.required),
    );
    const scripts = [generateFieldRenameCopyScript(change, everyRowFilled)];
    // The unique constraint is deferred to the post-migration phase, so
    // duplicates in the copied values must be resolved before it is enforced.
    // A previously unique source still needs the check when the copy itself
    // can collapse distinct values (e.g. a decreased decimal scale rounds
    // 1.231 and 1.232 both to 1.23).
    if (
      (change.after.unique ?? false) &&
      (!(change.before.unique ?? false) || renameCopyCanCollapseValues(change))
    ) {
      scripts.push(generateUniqueDedupeScript(change.tableName, change.fieldName, "suffix"));
    }
    return scripts;
  }

  if (change.kind === "table_renamed") {
    return [generateTypeRenameCopyScript(change)];
  }

  if (change.kind !== "field_modified" && change.kind !== "field_type_modified") {
    // No data migration needed for table_added, table_removed, or field_removed
    return [];
  }

  const { before, after } = change;
  const scripts: string[] = [];

  if (change.kind === "field_type_modified") {
    scripts.push(generateFieldTypeChangeScript(change));
  }

  if (change.kind === "field_modified" && change.memberRenames?.length) {
    scripts.push(generateNestedMemberRenameCopyScript(change));
  }

  // Optional to required
  if (!before.required && after.required) {
    scripts.push(`  // Set ${change.fieldName} for ${change.tableName} records where it is null
  await trx
    .updateTable("${change.tableName}")
    .set({
      ${change.fieldName}: TODO("set the value ${change.tableName}.${change.fieldName} takes where it is null"),
    })
    .where("${change.fieldName}", "is", null)
    .execute();`);
  }

  // Note: Array to single value change is rejected in generate.ts
  // No script generation needed here

  // Unique constraint added
  if (!deferUniqueConstraint) {
    const uniqueConstraintScript = generateUniqueConstraintScript(change);
    if (uniqueConstraintScript) {
      scripts.push(uniqueConstraintScript);
    }
  }

  // Enum values removed
  if (before.type === "enum" && after.type === "enum") {
    const beforeValues = (before.allowedValues ?? []).map((v) => v.value);
    const afterValues = (after.allowedValues ?? []).map((v) => v.value);
    const removedValues = beforeValues.filter((v) => !afterValues.includes(v));
    if (removedValues.length > 0) {
      const choices = afterValues.length > 0 ? ` (${afterValues.join(", ")})` : "";
      scripts.push(`  // Migrate records with removed enum values: ${removedValues.join(", ")}
  await trx
    .updateTable("${change.tableName}")
    .set({ ${change.fieldName}: TODO(${JSON.stringify(`choose the ${change.tableName}.${change.fieldName} value that replaces ${removedValues.join(", ")}${choices}`)}) })
    .where("${change.fieldName}", "in", [${removedValues.map((v) => JSON.stringify(v)).join(", ")}])
    .execute();`);
    }
  }

  // Foreign key relationship changed. A retarget that follows a confirmed
  // type rename needs no fixup: record ids are preserved by the rename copy.
  if (isBreakingForeignKeyRetarget(before, after, typeRenameTargets)) {
    scripts.push(`  // Migrate ${change.fieldName} references from ${before.foreignKeyType} to ${after.foreignKeyType}
  // Find records that don't have a valid reference in the new target table
  {
    const orphanedRecords = await trx
      .selectFrom("${change.tableName}")
      .leftJoin("${after.foreignKeyType}", "${change.tableName}.${change.fieldName}", "${after.foreignKeyType}.id")
      .select(["${change.tableName}.id", "${change.tableName}.${change.fieldName}"])
      .where("${after.foreignKeyType}.id", "is", null)
      .where("${change.tableName}.${change.fieldName}", "is not", null)
      .execute();
    for (const record of orphanedRecords) {
      await trx
        .updateTable("${change.tableName}")
        .set({ ${change.fieldName}: TODO("set the ${after.foreignKeyType} reference for ${change.tableName}.${change.fieldName}") })
        .where("id", "=", record.id)
        .execute();
    }
  }`);
  }

  return scripts;
}

function renameCopyCanCollapseValues(change: FieldRenamedChange): boolean {
  const { before, after } = change;
  if (before.type !== "decimal" || after.type !== "decimal") return false;
  return (after.scale ?? DEFAULT_DECIMAL_SCALE) < (before.scale ?? DEFAULT_DECIMAL_SCALE);
}

function generateFieldRenameCopyScript(
  change: FieldRenamedChange,
  everyRowFilled: boolean,
): string {
  const { tableName, fieldName, previousFieldName, before, after } = change;
  const requiredTodo =
    !before.required && after.required && !everyRowFilled
      ? `
  // ${previousFieldName} is optional but ${fieldName} is required: resolve its null values,
  // or the post-migration phase will fail.
  void TODO("resolve the null values of ${tableName}.${previousFieldName} that ${fieldName} cannot hold");`
      : "";
  const roundingWarning = renameCopyCanCollapseValues(change)
    ? `
  // WARNING: ${fieldName} has a smaller decimal scale than ${previousFieldName}, so
  // copied values that exceed it may be rounded half-up. Review the resulting
  // precision before deploying.`
    : "";

  return `  // Copy ${tableName}.${previousFieldName} into ${fieldName} for every row.
  // Overwrite unconditionally: stored values of previously removed fields are
  // not pruned, so a stale value could otherwise resurface under ${fieldName}.${requiredTodo}${roundingWarning}
  await trx
    .updateTable("${tableName}")
    .set((eb) => ({ ${fieldName}: eb.ref("${previousFieldName}") }))
    .execute();`;
}

function generateNestedMemberRenameCopyScript(change: FieldModifiedChange): string {
  const { tableName, fieldName } = change;
  const renames = change.memberRenames ?? [];
  const summary = renames
    .map((rename) => `${rename.previousPath.join(".")} → ${rename.path.join(".")}`)
    .join(", ");
  // A fixed local name keeps the generated code valid for any field name.
  const steps = renames
    .map(
      (rename) =>
        `        value = renameNestedMember(value, [${rename.previousPath.map((segment) => JSON.stringify(segment)).join(", ")}], ${JSON.stringify(rename.path[rename.path.length - 1])});`,
    )
    .join("\n");
  const column = JSON.stringify(fieldName);

  return `  // Copy renamed members inside ${tableName}.${fieldName}: ${summary}.
  // The old members stay on the schema until the post-migration phase drops
  // them, so they are kept in the written value.
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${tableName}")
        .select(["id", ${column}])
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        let value: unknown = row[${column}];
${steps}
        await trx
          .updateTable("${tableName}")
          .set({ [${column}]: value as never })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

// Emitted once per script that copies renamed nested members. Nested values
// reach the script as objects (or arrays of objects for array members).
const NESTED_MEMBER_RENAME_HELPER = `/**
 * Return a copy of a nested value with the member at \`path\` also stored under
 * \`newName\`, descending into arrays at every level.
 *
 * When the source member is absent, any value already stored under
 * \`newName\` is dropped rather than kept: stored values of previously removed
 * members are not pruned, so a stale value could otherwise resurface under
 * \`newName\`. This mirrors the unconditional overwrite of a top-level field
 * rename.
 */
function renameNestedMember(value: unknown, path: readonly string[], newName: string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => renameNestedMember(item, path, newName));
  if (typeof value !== "object") {
    throw new Error(\`Expected an object while renaming nested member \${path.join(".")}, got \${typeof value}\`);
  }
  const record = value as Record<string, unknown>;
  const [head, ...rest] = path;
  if (head === undefined || !Object.hasOwn(record, head)) {
    const copy = { ...record };
    if (rest.length === 0) delete copy[newName];
    return copy;
  }
  if (rest.length > 0) {
    return { ...record, [head]: renameNestedMember(record[head], rest, newName) };
  }
  const copy = { ...record };
  Object.defineProperty(copy, newName, {
    value: record[head],
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}
`;

function generateTypeRenameCopyScript(change: TableRenamedChange): string {
  const { tableName, previousTableName } = change;
  const columns = ["id", ...Object.keys(change.before.fields).filter((name) => name !== "id")];
  const columnList = columns.map((name) => JSON.stringify(name)).join(", ");
  // Self-referential foreign keys may point at rows in later batches, so they
  // are inserted as null and backfilled once every row exists.
  const selfRefColumns = Object.entries(change.after.fields)
    .filter(([, field]) => field.foreignKeyType === tableName)
    .map(([name]) => name);
  const insertValues =
    selfRefColumns.length > 0
      ? `pending.map((row) => ({ ...row, ${selfRefColumns.map((name) => `${name}: null`).join(", ")} }))`
      : "pending";
  const selfRefBackfill =
    selfRefColumns.length > 0
      ? `

  // Backfill the self-referential column(s) now that every row exists.
  await trx
    .updateTable("${tableName}")
    .set((eb) => ({
${selfRefColumns
  .map(
    (name) => `      ${name}: eb
        .selectFrom("${previousTableName}")
        .select("${previousTableName}.${name}")
        .whereRef("${previousTableName}.id", "=", "${tableName}.id"),`,
  )
  .join("\n")}
    }))
    .execute();`
      : "";

  return `  // Copy every ${previousTableName} row into ${tableName}, preserving ids so that
  // stored foreign key references remain valid. ${previousTableName} stays readable
  // until the post-migration phase drops it. Rows already copied by an earlier run are skipped.
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${previousTableName}")
        .select([${columnList}])
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      const copied = await trx
        .selectFrom("${tableName}")
        .select("id")
        .where("id", "in", rows.map((row) => row.id))
        .execute();
      const copiedIds = new Set(copied.map((row) => row.id));
      const pending = rows.filter((row) => !copiedIds.has(row.id));
      if (pending.length > 0) {
        await trx.insertInto("${tableName}").values(${insertValues}).execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }${selfRefBackfill}`;
}

function generateFieldTypeChangeScript(
  change: Extract<DiffChange, { kind: "field_type_modified" }>,
): string {
  return `  // Normalize ${change.tableName}.${change.fieldName} from ${change.before.type} to ${change.after.type} while the previous type is still active
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.tableName}")
        .select(["id", "${change.fieldName}"])
        .where("${change.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        const sourceValue = row.${change.fieldName};
        if (sourceValue === null) continue;
        const normalizedValue = TODO("normalize ${change.tableName}.${change.fieldName} to a value the active ${change.before.type} type accepts and the ${change.after.type} type can cast");
        if (Object.is(normalizedValue, sourceValue)) continue;
        await trx
          .updateTable("${change.tableName}")
          .set({ [${JSON.stringify(change.fieldName)}]: normalizedValue })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

/**
 * Lines that derive the value the conversion writes into the temporary field.
 *
 * Wrapping needs review when the element type changes or its accepted values narrow.
 * @param plan - Field change carried through a temporary field
 * @returns Script lines binding `convertedValue`
 */
function generateExpandConversionValue(plan: ExpandContractPlan): string {
  if (isSingleValueToArrayChange(plan.before, plan.after)) {
    return `        // Store the ${plan.before.type} value as the only element of the ${formatFieldShape(plan.after)} field.
        const sourceValue = row.${plan.fieldName};
        if (sourceValue === null) continue;
        const convertedValue = [sourceValue];`;
  }
  const target = plan.after.array
    ? `an element of the ${formatFieldShape(plan.after)} field`
    : `the ${plan.after.type} type`;
  return `        // Produce a value accepted by ${target} from the stored ${plan.before.type} value in row.${plan.fieldName}.
        const convertedValue = TODO(${JSON.stringify(`convert ${plan.tableName}.${plan.fieldName} to a value accepted by ${target}`)});`;
}

function generateExpandConversionScript(plan: ExpandContractPlan): string {
  const wrapsElement =
    (plan.after.array ?? false) && !isSingleValueToArrayChange(plan.before, plan.after);
  return `  // Convert ${plan.tableName}.${plan.fieldName} into ${plan.tempFieldName}, which the next migration renames back to ${plan.fieldName}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${plan.tableName}")
        .select(["id", "${plan.fieldName}"])
        .where("${plan.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
${generateExpandConversionValue(plan)}
        // Clearing ${plan.fieldName} keeps a re-run from converting the row twice.
        await trx
          .updateTable("${plan.tableName}")
          .set({
            [${JSON.stringify(plan.tempFieldName)}]: ${wrapsElement ? "[convertedValue]" : "convertedValue"},
            [${JSON.stringify(plan.fieldName)}]: null,
          })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

function generateUniqueConstraintScript(change: DiffChange): string | null {
  if (change.kind !== "field_modified" && change.kind !== "field_type_modified") return null;

  const { before, after } = change;
  if ((before.unique ?? false) || !(after.unique ?? false)) return null;

  return generateUniqueDedupeScript(
    change.tableName,
    change.fieldName,
    change.kind === "field_type_modified" ? "throw" : "suffix",
  );
}

function generateUniqueDedupeScript(
  tableName: string,
  fieldName: string,
  resolution: "suffix" | "throw",
): string {
  const duplicateResolution =
    resolution === "throw"
      ? `      if (records.length > 1) {
        TODO("resolve the duplicate ${tableName}.${fieldName} values before the unique constraint is added");
      }`
      : `      // Keep the first record and give the others a new value
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${tableName}")
          .set({ ${fieldName}: TODO("set a unique ${tableName}.${fieldName} value for the duplicates") })
          .where("id", "=", records[i].id)
          .execute();
      }`;

  return `  // Ensure ${fieldName} values are unique before adding constraint
  {
    const duplicates = await trx
      .selectFrom("${tableName}")
      .select(["${fieldName}"])
      .groupBy("${fieldName}")
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      // Load every record in this duplicate group before resolving it
      const records = await trx
        .selectFrom("${tableName}")
        .select(["id", "${fieldName}"])
        .where("${fieldName}", "=", dup.${fieldName})
        .execute();
${duplicateResolution}
    }
  }`;
}

function generateDecimalScaleChangeScript(change: DiffChange): string | null {
  if (change.kind !== "field_modified") return null;

  const { before, after } = change;
  if (before.type !== "decimal" || after.type !== "decimal" || before.scale === after.scale)
    return null;

  const valueExpression =
    !before.required && after.required ? `row.${change.fieldName}!` : `row.${change.fieldName}`;
  const beforeScale = before.scale ?? DEFAULT_DECIMAL_SCALE;
  const afterScale = after.scale ?? DEFAULT_DECIMAL_SCALE;
  const roundingWarning =
    afterScale < beforeScale
      ? `
  // WARNING: Values that exceed the new scale may be rounded half-up, so
  // review the resulting precision before deploying.`
      : "";

  return `  // Re-save existing ${change.tableName} rows so ${change.fieldName} is stored under the new scale.
  // This is a workaround for a platform-side gap where rows written under the
  // previous scale could fail on later updates until re-saved. Keep it unless
  // your platform is confirmed to handle stored values across scale changes.${roundingWarning}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.tableName}")
        .select(["id", "${change.fieldName}"])
        .where("${change.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        await trx
          .updateTable("${change.tableName}")
          .set({ ${change.fieldName}: ${valueExpression} })
          .where("id", "=", row.id)
          .where("${change.fieldName}", "=", ${valueExpression})
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

/**
 * Check if a migration script exists for a given migration number
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @returns {Promise<boolean>} True if script exists
 */
export async function migrationScriptExists(
  migrationsDir: string,
  migrationNumber: number,
): Promise<boolean> {
  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  return fileExists(filePath);
}

/**
 * Get the migration script path for a given migration number
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @returns {string} Full path to migration script
 */
export function getMigrationScriptPath(migrationsDir: string, migrationNumber: number): string {
  return getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
}

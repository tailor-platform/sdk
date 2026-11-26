import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { jsonlRecordLines } from "lines-db";
import * as path from "pathe";
import {
  deployMigrationTestBaseline,
  deployMigrationTestTarget,
} from "#/cli/commands/deploy/deploy";
import { resourceTrn } from "#/cli/commands/deploy/label";
import {
  pendingMigrationsAfter,
  resolveMigrationMachineUsers,
  resolveScriptMachineUsers,
  updateMigrationLabel,
  type MigrationMachineUsers,
} from "#/cli/commands/deploy/tailordb/migration";
import { checkpointRepairInProgressConflict } from "#/cli/commands/deploy/tailordb/migration-validation";
import { bundleSeedScript } from "#/cli/commands/generate/seed/bundler";
import {
  fetchRemoteSchemaSnapshot,
  PULL_LATEST_MIGRATIONS_SUGGESTION,
  toTailorDBDeployInput,
  type TailorDBDeployInput,
  verifyRemoteSchema,
} from "#/cli/commands/tailordb/migrate/schema-checks";
import { parseAge } from "#/cli/commands/workspace/age";
import { createValidatedWorkspaceWithClient } from "#/cli/commands/workspace/create";
import { writeWorkspaceExpiry } from "#/cli/commands/workspace/expiry";
import { type RecoveryContext } from "#/cli/shared/args";
import { buildOptionsOf } from "#/cli/shared/build-options";
import { getOrNull, initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { configOf } from "#/cli/shared/config-file";
import { loadAccessToken, loadPlatformClientConfig, loadWorkspaceId } from "#/cli/shared/context";
import { effectiveDateDefault } from "#/cli/shared/date-default";
import { CLIError, internalError, locatedCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { executeScript } from "#/cli/shared/script-executor";
import { chunkSeedData, type SeedData } from "#/cli/shared/seed-chunker";
import { loadSeedContext, type SeedContext } from "#/cli/shared/seed-context";
import { loadConfigFileNamespaces } from "#/cli/shared/tailordb-namespaces";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { assertDefined } from "#/utils/assert";
import { collectForeignKeyTargets } from "#/utils/foreign-key-targets";
import { bundleMigrationScript } from "./bundler";
import { getNamespacesWithMigrations, migrationConfigNotFoundError } from "./config";
import { formatNamespaceMigrationHint, migrationCommandContext } from "./hints";
import { assertNoMigrationInProgress, fetchRemoteMigrationState } from "./remote-state";
import {
  assertValidMigrationFiles,
  compareSnapshots,
  formatMigrationNumber,
  getLatestMigrationNumber,
  normalizeSchemaSnapshot,
  reconstructSnapshotFromMigrations,
  type NormalizedSchemaSnapshot,
  type SnapshotFieldConfig,
} from "./snapshot";
import { formatSchemaDrifts } from "./snapshot-remote";
import type { ConfigServices } from "#/cli/services/application";
import type {
  LoadedConfig,
  LoadedConfigFile,
  LoadedWorkspaceConfig,
} from "#/cli/shared/config-loader";
import type { Plugin, TailorDBNamespaceData } from "#/plugin/types";
import type {
  MigrationTestDependencies,
  MigrationTestOptions,
  PreparedMigrationTest,
  PreparedAssertion,
} from "./test-types";
import type { PendingMigration, RemoteSchemaVerificationResult } from "./types";
import type { JsonObject, JsonValue } from "type-fest";

const CLONE_POLL_INTERVAL = 3_000;
const CLONE_TIMEOUT = 30 * 60 * 1_000;
const CLOCK_SKEW_TOLERANCE = 100;

/** A config file with the services it defines and its loaded TailorDB namespaces. */
interface MigrationTestLoaded {
  file: LoadedConfigFile;
  config: LoadedConfig | LoadedWorkspaceConfig;
  application: ConfigServices;
  plugins: Plugin[];
  namespaces: TailorDBNamespaceData[];
}

interface RuntimeState {
  client: OperatorClient;
  loaded: MigrationTestLoaded;
  options: MigrationTestOptions;
  seeds: PreparedSeed[];
  seedMachineUsers?: MigrationMachineUsers | undefined;
}

interface PreparedSeed {
  namespace: string;
  data: SeedData;
  order: string[];
  selfRefTypes: string[];
  typesWithData: string[];
}

interface WaitForCloneOptions {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  operationId: string;
  pollInterval?: number | undefined;
  timeout?: number | undefined;
  errorCodePrefix?: string | undefined;
  onStatus?: ((status: CloneOperationStatus) => void) | undefined;
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function assertSeedDataDirectory(dataDir: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(dataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw CLIError({
        code: "SEED_DATA_NOT_FOUND",
        message: `Seed data directory not found: ${dataDir}.`,
        suggestion: "Generate seed data before testing migrations.",
        cause: error,
      });
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw CLIError({
      code: "SEED_DATA_INVALID",
      message: `Seed data path is not a directory: ${dataDir}`,
    });
  }
}

function assertAssertionScript(assertionPath: string): void {
  const resolvedPath = path.resolve(assertionPath);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw CLIError({
        code: "MIGRATION_ASSERTION_SCRIPT_NOT_FOUND",
        message: `Migration assertion script not found: ${resolvedPath}`,
        cause: error,
      });
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw CLIError({
      code: "MIGRATION_ASSERTION_SCRIPT_INVALID",
      message: `Migration assertion path is not a file: ${resolvedPath}`,
    });
  }
}

/**
 * Require a designated clone target to share the source workspace's region.
 * @param sourceRegion - Source workspace region
 * @param targetRegion - Target workspace region
 */
export function assertCloneTargetRegion(sourceRegion: string, targetRegion: string): void {
  if (sourceRegion !== targetRegion) {
    throw CLIError({
      code: "MIGRATION_TEST_REGION_MISMATCH",
      message: `Clone mode requires source and target workspaces in the same region (source: ${sourceRegion}, target: ${targetRegion}).`,
    });
  }
}

/**
 * Require the migration test target workspace to differ from the source workspace.
 * @param sourceWorkspaceId - Source workspace ID
 * @param targetWorkspaceId - Designated target workspace ID, if any
 */
export function assertTargetWorkspaceDiffers(
  sourceWorkspaceId: string,
  targetWorkspaceId?: string,
): void {
  if (targetWorkspaceId?.toLowerCase() === sourceWorkspaceId.toLowerCase()) {
    throw CLIError({
      code: "MIGRATION_TEST_TARGET_INVALID",
      message: "The migration test target workspace must differ from the source workspace.",
      command: "tailordb migration test",
    });
  }
}

/**
 * Resolve the namespace an assertion script runs against.
 * @param pendingNamespaces - Namespaces with pending migrations
 * @param assertionNamespace - Explicit namespace from `--assert-namespace`, if any
 * @returns Resolved assertion namespace
 */
export function resolveAssertionNamespace(
  pendingNamespaces: ReadonlyArray<string>,
  assertionNamespace?: string,
): string {
  const namespace =
    assertionNamespace ?? (pendingNamespaces.length === 1 ? pendingNamespaces[0] : undefined);
  if (!namespace) {
    throw CLIError({
      code: "MIGRATION_TEST_ASSERT_NAMESPACE_REQUIRED",
      message: "--assert-namespace is required when pending migrations span multiple namespaces.",
      command: "tailordb migration test",
    });
  }
  if (!pendingNamespaces.includes(namespace)) {
    throw CLIError({
      code: "MIGRATION_TEST_NO_PENDING_MIGRATIONS",
      message: `Assertion namespace "${namespace}" has no pending migrations.`,
    });
  }
  return namespace;
}

interface CreateBaselineSnapshotsOptions {
  client: OperatorClient;
  workspaceId: string;
  dataMode: MigrationTestOptions["data"];
  inputs: ReadonlyArray<TailorDBDeployInput>;
  baselines: PreparedMigrationTest["baselines"];
}

/**
 * Build the schema overrides used before migration-test data is loaded.
 * @param options - Source workspace, local inputs, and migration baselines
 * @returns Schema snapshots keyed by namespace
 */
export async function createMigrationTestBaselineSnapshots(
  options: CreateBaselineSnapshotsOptions,
): Promise<Map<string, NormalizedSchemaSnapshot>> {
  const snapshots = new Map(
    [...options.baselines].map(([namespace, baseline]) => [namespace, baseline.snapshot]),
  );
  if (options.dataMode !== "clone") return snapshots;

  const unmigratedInputs = options.inputs.filter((input) => !snapshots.has(input.namespace));
  const remoteSnapshots = await Promise.all(
    unmigratedInputs.map((input) =>
      fetchRemoteSchemaSnapshot(options.client, options.workspaceId, input.namespace),
    ),
  );
  unmigratedInputs.forEach((input, index) => {
    snapshots.set(
      input.namespace,
      assertDefined(remoteSnapshots[index], `remote snapshot missing for "${input.namespace}"`),
    );
  });
  return snapshots;
}

/**
 * Wait for an application-data clone operation to reach a terminal state.
 * @param client - Operator client
 * @param options - Clone operation identifiers and polling limits
 */
export async function waitForCloneApplicationData(
  client: OperatorClient,
  options: WaitForCloneOptions,
): Promise<void> {
  const pollInterval = options.pollInterval ?? CLONE_POLL_INTERVAL;
  const timeout = options.timeout ?? CLONE_TIMEOUT;
  const errorCodePrefix = options.errorCodePrefix ?? "MIGRATION_TEST_CLONE";
  const deadline = Date.now() + timeout;
  let reportedStatus: CloneOperationStatus | undefined;

  for (let remaining = timeout; remaining > 0; remaining = deadline - Date.now()) {
    let operation;
    try {
      operation = await client.getCloneApplicationDataOperation(
        {
          sourceWorkspaceId: options.sourceWorkspaceId,
          targetWorkspaceId: options.targetWorkspaceId,
          operationId: options.operationId,
        },
        Number.isFinite(remaining) ? { timeoutMs: remaining } : undefined,
      );
    } catch (error) {
      if (
        error instanceof ConnectError &&
        error.code === Code.DeadlineExceeded &&
        Date.now() >= deadline - CLOCK_SKEW_TOLERANCE
      ) {
        break;
      }
      throw error;
    }
    if (operation.status === CloneOperationStatus.COMPLETED) {
      return;
    }
    if (operation.status === CloneOperationStatus.FAILED) {
      throw CLIError({
        code: `${errorCodePrefix}_FAILED`,
        message: `Application data clone failed: ${operation.errorMessage || "unknown platform error"}`,
      });
    }
    if (
      operation.status !== CloneOperationStatus.PENDING &&
      operation.status !== CloneOperationStatus.PROCESSING
    ) {
      throw internalError(`Application data clone returned unexpected status ${operation.status}.`);
    }
    if (operation.status !== reportedStatus) {
      reportedStatus = operation.status;
      options.onStatus?.(operation.status);
    }
    await delay(Math.min(pollInterval, Math.max(deadline - Date.now(), 0)));
  }

  throw CLIError({
    code: `${errorCodePrefix}_TIMEOUT`,
    message: `Application data clone timed out after ${timeout < 1_000 ? `${timeout} ms` : `${Math.round(timeout / 1_000)} seconds`}.`,
    context: {
      operationId: options.operationId,
      sourceWorkspaceId: options.sourceWorkspaceId,
      targetWorkspaceId: options.targetWorkspaceId,
    },
  });
}

/**
 * Load generated JSONL seed rows for the tables in a baseline snapshot.
 * @param dataDir - Directory containing `<Type>.jsonl` files
 * @param tableNames - Baseline table names to load
 * @param snapshot - Baseline schema used to remove fields introduced by pending migrations
 * @returns Seed rows keyed by table name
 */
export function loadSnapshotSeedData(
  dataDir: string,
  tableNames: string[],
  snapshot?: NormalizedSchemaSnapshot,
): SeedData {
  const data: SeedData = {};
  for (const tableName of tableNames) {
    const snapshotType = snapshot?.tables[tableName];
    const jsonlPath = path.join(dataDir, `${tableName}.jsonl`);
    let content: string;
    try {
      content = fs.readFileSync(jsonlPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        data[tableName] = [];
        continue;
      }
      throw error;
    }
    data[tableName] = jsonlRecordLines(content).flatMap(({ text, line }) => {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        throw seedRowInvalidError(
          jsonlPath,
          line,
          `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw seedRowInvalidError(jsonlPath, line, "Invalid seed row: expected a JSON object");
      }
      const row = value as JsonObject;
      return [snapshotType ? projectSeedObject(row, snapshotType.fields, new Set(["id"])) : row];
    });
  }
  return data;
}

function seedRowInvalidError(
  file: string,
  line: number,
  message: string,
  cause?: unknown,
): CLIError {
  return locatedCLIError({ file, line }, { code: "SEED_DATA_INVALID", message, cause });
}

function projectSeedObject(
  value: JsonObject,
  fields: Readonly<Record<string, SnapshotFieldConfig>>,
  implicitFields: ReadonlySet<string> = new Set(),
): JsonObject {
  return Object.fromEntries(
    Object.entries(value).flatMap(([fieldName, fieldValue]) => {
      const field = fields[fieldName];
      if (!field) return implicitFields.has(fieldName) ? [[fieldName, fieldValue]] : [];
      return [[fieldName, projectSeedValue(fieldValue, field)]];
    }),
  );
}

function projectSeedValue(value: JsonValue, field: SnapshotFieldConfig): JsonValue {
  const fields = field.fields;
  if (!fields) return value;
  if (field.array) {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => (isJsonObject(entry) ? projectSeedObject(entry, fields) : entry));
  }
  return isJsonObject(value) ? projectSeedObject(value, fields) : value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Derive insertion order and self-referencing tables from a baseline snapshot.
 * @param snapshot - Baseline schema snapshot
 * @returns Dependency-ordered type names and self-referencing types
 */
export function sortSeedTypesForSnapshot(snapshot: NormalizedSchemaSnapshot): {
  order: string[];
  selfRefTypes: string[];
} {
  const tableNames = Object.keys(snapshot.tables);
  const available = new Set(tableNames);
  const dependencies = new Map<string, string[]>();
  const selfRefTypes: string[] = [];
  for (const [tableName, type] of Object.entries(snapshot.tables)) {
    const referenced = new Set<string>();
    for (const target of collectForeignKeyTargets(type.fields)) {
      if (target === tableName) {
        selfRefTypes.push(tableName);
      } else if (available.has(target)) {
        referenced.add(target);
      }
    }
    dependencies.set(tableName, [...referenced]);
  }

  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (tableName: string): void => {
    if (visited.has(tableName)) return;
    visited.add(tableName);
    for (const dependency of dependencies.get(tableName) ?? []) {
      visit(dependency);
    }
    order.push(tableName);
  };
  for (const tableName of tableNames) {
    visit(tableName);
  }
  return { order, selfRefTypes };
}

function temporaryWorkspaceName(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `migration-test-${timestamp}-${randomBytes(3).toString("hex")}`;
}

function stateOrThrow(state: RuntimeState | undefined): RuntimeState {
  return assertDefined(state, "migration test runtime was used before preparation");
}

interface TemporaryWorkspaceLocation {
  organizationId?: string | undefined;
  folderId?: string | undefined;
}

interface DesignatedTargetLocation extends TemporaryWorkspaceLocation {
  id: string;
}

/**
 * Decide the organization and folder the temporary workspace is created in.
 *
 * Only `--organization-id` places it at that organization's root; the source
 * folder is not carried over because it may belong to another organization.
 * @param client - Operator client
 * @param source - Organization and folder of the source workspace
 * @param options - `--organization-id` and `--folder-id` values
 * @returns The location to pass to workspace creation
 */
export async function resolveTemporaryWorkspaceLocation(
  client: OperatorClient,
  source: TemporaryWorkspaceLocation,
  options: TemporaryWorkspaceLocation,
): Promise<TemporaryWorkspaceLocation> {
  if (!options.organizationId && !options.folderId) {
    return {
      ...(source.organizationId ? { organizationId: source.organizationId } : {}),
      ...(source.folderId ? { folderId: source.folderId } : {}),
    };
  }
  const { folderId } = options;
  const organizationId = options.organizationId ?? (source.organizationId || undefined);
  if (folderId && !organizationId) {
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--folder-id requires --organization-id.",
      details: "The source workspace is not in an organization.",
      suggestion: "Pass --organization-id together with --folder-id.",
    });
  }
  if (folderId && organizationId) {
    const folder = await getOrNull(async () => {
      const { folder } = await client.getOrganizationFolder({ organizationId, folderId });
      return folder;
    });
    if (!folder) {
      throw CLIError({
        code: "MIGRATION_TEST_OPTIONS_INVALID",
        message: `Folder "${folderId}" was not found in organization "${organizationId}"${
          options.organizationId ? "" : " (the source workspace's organization)"
        }.`,
        details:
          "The folder does not exist there, belongs to a different organization, or is not accessible.",
        suggestion: options.organizationId
          ? "Pass a --folder-id that belongs to --organization-id."
          : "Pass --organization-id together with --folder-id if the folder is in another organization.",
      });
    }
  }
  return {
    ...(organizationId ? { organizationId } : {}),
    ...(folderId ? { folderId } : {}),
  };
}

/**
 * Require the designated target workspace to be where `--organization-id` and
 * `--folder-id` say, since a target that already exists cannot be moved.
 * @param target - Designated target workspace
 * @param options - `--organization-id` and `--folder-id` values
 */
export function assertTargetMatchesLocation(
  target: DesignatedTargetLocation,
  options: TemporaryWorkspaceLocation,
): void {
  const checks = [
    {
      flag: "--organization-id",
      kind: "organization",
      wanted: options.organizationId,
      actual: target.organizationId,
    },
    { flag: "--folder-id", kind: "folder", wanted: options.folderId, actual: target.folderId },
  ];
  for (const { flag, kind, wanted, actual } of checks) {
    if (wanted === undefined || wanted.toLowerCase() === actual?.toLowerCase()) continue;
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: `${flag} "${wanted}" does not match the designated target workspace "${target.id}", which ${
        actual ? `is in ${kind} "${actual}"` : `has no ${kind}`
      }.`,
      suggestion: `Pass the ${kind} the target workspace is in, or omit ${flag}.`,
    });
  }
}

/** Source workspace and config of a migration test, kept in the commands its errors suggest. */
export interface MigrationTestSource extends RecoveryContext {
  workspaceId: string;
  configPath: string;
}

/**
 * Require every source namespace to match its migration checkpoint, with no
 * checkpoint repair pending and no table its checkpoint's migration removed
 * left to delete.
 * @param checks - Remote schema verification results of the source namespaces
 * @param source - Source workspace and config, kept in the suggested commands
 */
export function assertSourceMatchesCheckpoints(
  checks: readonly RemoteSchemaVerificationResult[],
  source: MigrationTestSource,
): void {
  const invalidRemote = checks.find((check) => check.hasDrift || check.checkpointMissingLocal);
  if (invalidRemote?.checkpointUnset) {
    throw CLIError({
      code: "MIGRATION_TEST_SOURCE_INVALID",
      message: `Source namespace "${invalidRemote.namespace}" has no migration label and its schema differs from the initial migration snapshot (0000).`,
      details: formatSchemaDrifts(invalidRemote.drifts),
      suggestion: "Bring the source schema in line with 0000 or set its migration label.",
    });
  }
  if (invalidRemote) {
    const hintOptions = { ...migrationCommandContext(source), namespace: invalidRemote.namespace };
    const statusHint = formatNamespaceMigrationHint({ ...hintOptions, subcommand: ["status"] });
    const validateHint = formatNamespaceMigrationHint({ ...hintOptions, subcommand: ["validate"] });
    throw CLIError({
      code: "MIGRATION_TEST_SOURCE_INVALID",
      message: `Source namespace "${invalidRemote.namespace}" does not match its migration checkpoint.`,
      ...(invalidRemote.hasDrift ? { details: formatSchemaDrifts(invalidRemote.drifts) } : {}),
      suggestion: invalidRemote.checkpointMissingLocal
        ? `${PULL_LATEST_MIGRATIONS_SUGGESTION} Otherwise run ${statusHint} to compare the source workspace's checkpoint and migration history with the local ones.`
        : `Run ${validateHint} to check the migration history and source schema, or ${statusHint} to inspect the source workspace's checkpoint.`,
    });
  }
  const pendingRepairs = checks.filter((check) => check.checkpointRepair);
  for (const repair of pendingRepairs) {
    const conflict = checkpointRepairInProgressConflict(repair.namespace, {
      inProgress: repair.migrationInProgress ?? null,
      inProgressInvalid: repair.migrationInProgressInvalid ?? false,
    });
    if (conflict) throw conflict;
  }
  const pendingRepair = pendingRepairs[0];
  if (pendingRepair) {
    throw CLIError({
      code: "MIGRATION_TEST_SOURCE_REPAIR_PENDING",
      message: `Source namespace "${pendingRepair.namespace}" has a pending migration checkpoint repair.`,
      suggestion: "Deploy to the source workspace first.",
    });
  }
  const pendingRemoval = checks.find((check) => check.unfinishedRemovals?.length);
  if (pendingRemoval) {
    throw CLIError({
      code: "MIGRATION_TEST_SOURCE_CLEANUP_PENDING",
      message: `Source namespace "${pendingRemoval.namespace}" still has tables that migration ${formatMigrationNumber(pendingRemoval.remoteMigrationNumber)} removed: ${pendingRemoval.unfinishedRemovals?.join(", ")}.`,
      suggestion: "Deploy to the source workspace first.",
    });
  }
}

/**
 * Resolve the migration number a source namespace is at, the way `deploy` does:
 * a namespace that has tables but no migration label is at 0.
 * @param check - Remote schema verification result of the source namespace
 * @returns The labeled number, or 0 for an unlabeled namespace
 */
export function resolveSourceMigrationNumber(check: RemoteSchemaVerificationResult): number {
  if (check.skipped === "not_deployed") {
    throw CLIError({
      code: "MIGRATION_TEST_SOURCE_CHECKPOINT_MISSING",
      message: `Source namespace "${check.namespace}" has not been deployed.`,
      suggestion: "Deploy to the source workspace before testing.",
    });
  }
  return check.remoteMigrationNumber;
}

function findSourceCheck(
  checks: readonly RemoteSchemaVerificationResult[],
  namespace: string,
): RemoteSchemaVerificationResult {
  return assertDefined(
    checks.find((check) => check.namespace === namespace),
    `remote schema check result missing for namespace "${namespace}"`,
  );
}

/**
 * Require the source workspace to still match the prepared baselines.
 *
 * The source is verified during preparation, but the baseline deploy runs in
 * between; a source deploy in that window would make the clone diverge from
 * the already-deployed baseline schemas.
 * @param state - Prepared migration test runtime state
 * @param prepared - Baselines captured during preparation
 * @param sourceWorkspaceId - Source workspace ID
 */
export async function assertSourceBaselineFresh(
  state: RuntimeState,
  prepared: PreparedMigrationTest,
  sourceWorkspaceId: string,
): Promise<void> {
  const loaded = state.loaded;
  const commandContext = migrationCommandContext({
    workspaceId: sourceWorkspaceId,
    profile: state.options.profile,
    configPath: loaded.config.path,
  });
  const namespaces = getNamespacesWithMigrations(loaded.config, path.dirname(loaded.config.path));
  const inputs = loaded.application.tailorDBServices.map(toTailorDBDeployInput);
  const remoteChecks = await verifyRemoteSchema(
    state.client,
    sourceWorkspaceId,
    namespaces,
    loaded.config,
    inputs,
  );
  const invalidRemote = remoteChecks.find(
    (check) => check.hasDrift || check.checkpointMissingLocal || check.checkpointRepair,
  );
  if (invalidRemote) {
    throw CLIError({
      code: "MIGRATION_TEST_SOURCE_CHANGED",
      message: `Source namespace "${invalidRemote.namespace}" changed after migration test preparation.`,
      suggestion: "Run the migration test again.",
    });
  }
  for (const namespace of namespaces) {
    const baseline = prepared.baselines.get(namespace.namespace);
    if (!baseline) continue;
    const remoteState = await fetchRemoteMigrationState(
      state.client,
      resourceTrn(sourceWorkspaceId, "tailordb", namespace.namespace),
    );
    assertNoMigrationInProgress(remoteState, namespace.namespace, commandContext);
    const migrationNumber = resolveSourceMigrationNumber(
      findSourceCheck(remoteChecks, namespace.namespace),
    );
    if (migrationNumber !== baseline.migrationNumber) {
      throw CLIError({
        code: "MIGRATION_TEST_SOURCE_CHANGED",
        message: `Source namespace "${namespace.namespace}" moved from migration ${baseline.migrationNumber} to ${migrationNumber} after migration test preparation.`,
        suggestion: "Run the migration test again.",
      });
    }
  }
  const unmigratedInputs = inputs.filter((input) => !prepared.baselines.has(input.namespace));
  for (const input of unmigratedInputs) {
    const snapshot = prepared.baselineSnapshots.get(input.namespace);
    if (!snapshot) continue;
    const current = await fetchRemoteSchemaSnapshot(
      state.client,
      sourceWorkspaceId,
      input.namespace,
    );
    if (compareSnapshots(snapshot, current).changes.length > 0) {
      throw CLIError({
        code: "MIGRATION_TEST_SOURCE_CHANGED",
        message: `Source namespace "${input.namespace}" schema changed after migration test preparation.`,
        suggestion: "Run the migration test again.",
      });
    }
  }
}

/**
 * Delete the target workspace's user profile config when one exists.
 *
 * A retained target may carry a user profile config referencing tables the
 * baseline deploy replaces; deleting it up front lets the baseline's planAuth
 * see no existing config instead of reordering delete phases.
 * @param state - Prepared migration test runtime state
 * @param targetWorkspaceId - Target workspace ID
 */
export async function deleteExistingUserProfileConfig(
  state: RuntimeState,
  targetWorkspaceId: string,
): Promise<void> {
  for (const auth of state.loaded.application.authServices) {
    const namespaceName = auth.config.name;
    const existing = await getOrNull(() =>
      state.client.getUserProfileConfig({ workspaceId: targetWorkspaceId, namespaceName }),
    );
    if (!existing) continue;
    await state.client.deleteUserProfileConfig({ workspaceId: targetWorkspaceId, namespaceName });
  }
}

/**
 * Choose the application whose data `--data clone` copies. The Platform clones one application's
 * data, so a workspace config must deploy a single application, and that application must list
 * every namespace with pending migrations.
 * @param file - Loaded config file
 * @param pendingNamespaces - Namespaces with pending migrations
 * @returns Name of the application to clone
 */
export function migrationTestCloneApplication(
  file: LoadedConfigFile,
  pendingNamespaces: readonly string[],
): string {
  if (file.kind === "config") return file.config.name;
  const apps = Object.entries(file.workspace.apps);
  const [only, ...others] = apps;
  const unlisted = only ? pendingNamespaces.filter((ns) => !only[1].db.includes(ns)) : [];
  if (only && others.length === 0 && unlisted.length === 0) return only[0];
  throw CLIError({
    code: "MIGRATION_TEST_CLONE_UNSUPPORTED",
    message:
      only && others.length === 0
        ? `--data clone copies the data of application ${only[0]}, which does not list ${unlisted.join(", ")}.`
        : "--data clone copies the data of one application, but the workspace config deploys several.",
    suggestion: "Use --data seed.",
    context: {
      applications: apps.map(([name]) => name),
      pendingNamespaces: [...pendingNamespaces],
    },
  });
}

function prepareSeedData(
  loaded: MigrationTestLoaded,
  seedContext: SeedContext,
  baselines: PreparedMigrationTest["baselines"],
): PreparedSeed[] {
  const dataDir = path.join(seedContext.distPath, "data");
  const seeds: PreparedSeed[] = [];
  for (const service of loaded.application.tailorDBServices) {
    const input = toTailorDBDeployInput(service);
    const snapshot =
      baselines.get(service.namespace)?.snapshot ??
      normalizeSchemaSnapshot({
        version: 1,
        namespace: service.namespace,
        createdAt: new Date().toISOString(),
        tables: input.types,
      });
    const { order, selfRefTypes } = sortSeedTypesForSnapshot(snapshot);
    const data = loadSnapshotSeedData(dataDir, order, snapshot);
    const typesWithData = order.filter((tableName) => (data[tableName]?.length ?? 0) > 0);
    if (typesWithData.length > 0) {
      seeds.push({ namespace: service.namespace, data, order, selfRefTypes, typesWithData });
    }
  }
  return seeds;
}

interface SourceApplication {
  workspaceId: string;
  applicationName: string;
}

async function assertSourceApplication(
  client: OperatorClient,
  source: SourceApplication,
): Promise<void> {
  const { application } = await client.getApplication(source);
  assertDefined(
    application,
    `application "${source.applicationName}" not found in source workspace`,
  );
}

async function prepareMigrationTest(options: MigrationTestOptions): Promise<{
  state: RuntimeState;
  prepared: PreparedMigrationTest;
}> {
  const fileNamespaces = await loadConfigFileNamespaces({ configPath: options.configPath });
  const loaded: MigrationTestLoaded = {
    file: fileNamespaces.loaded,
    config: configOf(fileNamespaces.loaded),
    application: fileNamespaces.services,
    plugins: fileNamespaces.loaded.plugins,
    namespaces: fileNamespaces.namespaces,
  };
  const configDir = path.dirname(loaded.config.path);
  const namespaces = getNamespacesWithMigrations(loaded.config, configDir);
  if (namespaces.length === 0) {
    throw migrationConfigNotFoundError();
  }
  for (const namespace of namespaces) {
    assertValidMigrationFiles(namespace.migrationsDir, namespace.namespace, loaded.config.path);
  }

  let seedContext: SeedContext | undefined;
  if (options.data === "seed") {
    seedContext = await loadSeedContext({ configPath: loaded.config.path });
    assertSeedDataDirectory(path.join(seedContext.distPath, "data"));
  }
  if (options.assertionPath) {
    assertAssertionScript(options.assertionPath);
  }

  const inputs = loaded.application.tailorDBServices.map(toTailorDBDeployInput);
  const accessToken = await loadAccessToken({ profile: options.profile });
  const platformConfig = await loadPlatformClientConfig({ profile: options.profile });
  const client = await initOperatorClient(accessToken, platformConfig);
  const sourceWorkspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });
  assertTargetWorkspaceDiffers(sourceWorkspaceId, options.targetWorkspaceId);

  const configApplicationName = loaded.file.kind === "config" ? loaded.file.config.name : undefined;
  const [workspaceResponse, targetWorkspaceResponse] = await Promise.all([
    client.getWorkspace({ workspaceId: sourceWorkspaceId }),
    options.targetWorkspaceId
      ? client.getWorkspace({ workspaceId: options.targetWorkspaceId })
      : Promise.resolve(undefined),
    configApplicationName === undefined
      ? Promise.resolve()
      : assertSourceApplication(client, {
          workspaceId: sourceWorkspaceId,
          applicationName: configApplicationName,
        }),
  ]);
  const sourceWorkspace = assertDefined(
    workspaceResponse.workspace,
    `source workspace "${sourceWorkspaceId}" not found`,
  );
  const designatedTarget = targetWorkspaceResponse
    ? assertDefined(
        targetWorkspaceResponse.workspace,
        `target workspace "${options.targetWorkspaceId}" not found`,
      )
    : undefined;

  if (designatedTarget) assertTargetMatchesLocation(designatedTarget, options);
  const temporaryLocation = await resolveTemporaryWorkspaceLocation(
    client,
    sourceWorkspace,
    designatedTarget ? {} : options,
  );

  const remoteChecks = await verifyRemoteSchema(
    client,
    sourceWorkspaceId,
    namespaces,
    loaded.config,
    inputs,
    { acceptUnfinishedRemovals: true },
  );
  const source: MigrationTestSource = {
    workspaceId: sourceWorkspaceId,
    profile: options.profile,
    configPath: loaded.config.path,
  };
  assertSourceMatchesCheckpoints(remoteChecks, source);

  const baselines = new Map<
    string,
    { migrationNumber: number; snapshot: NormalizedSchemaSnapshot; historyId: string | null }
  >();
  const targetSnapshots = new Map<string, NormalizedSchemaSnapshot>();
  const pendingNamespaces: string[] = [];
  const pendingMigrations: PendingMigration[] = [];
  for (const namespace of namespaces) {
    const remoteState = await fetchRemoteMigrationState(
      client,
      resourceTrn(sourceWorkspaceId, "tailordb", namespace.namespace),
    );
    assertNoMigrationInProgress(remoteState, namespace.namespace, migrationCommandContext(source));
    const migrationNumber = resolveSourceMigrationNumber(
      findSourceCheck(remoteChecks, namespace.namespace),
    );
    const latest = getLatestMigrationNumber(namespace.migrationsDir);
    if (migrationNumber > latest) {
      throw CLIError({
        code: "MIGRATION_TEST_SOURCE_AHEAD",
        message: `Source namespace "${namespace.namespace}" is at migration ${migrationNumber}, but the local history ends at ${latest}.`,
      });
    }
    const snapshot = reconstructSnapshotFromMigrations(namespace.migrationsDir, migrationNumber);
    if (!snapshot) {
      throw CLIError({
        code: "MIGRATION_BASELINE_NOT_FOUND",
        message: `No migration baseline snapshot found for namespace "${namespace.namespace}".`,
      });
    }
    baselines.set(namespace.namespace, {
      migrationNumber,
      snapshot,
      historyId: snapshot.rebaseline?.historyId ?? null,
    });
    const targetSnapshot = reconstructSnapshotFromMigrations(namespace.migrationsDir, latest);
    if (!targetSnapshot) {
      throw CLIError({
        code: "MIGRATION_TEST_SNAPSHOT_NOT_FOUND",
        message: `No target migration snapshot found for namespace "${namespace.namespace}".`,
      });
    }
    targetSnapshots.set(namespace.namespace, targetSnapshot);
    if (migrationNumber < latest) {
      pendingNamespaces.push(namespace.namespace);
      pendingMigrations.push(
        ...pendingMigrationsAfter(namespace.namespace, namespace.migrationsDir, migrationNumber),
      );
    }
  }
  if (pendingNamespaces.length === 0) {
    throw CLIError({
      code: "MIGRATION_TEST_NO_PENDING_MIGRATIONS",
      message: "No pending TailorDB migrations found in the source workspace.",
    });
  }
  const sourceApplicationName =
    options.data === "clone"
      ? migrationTestCloneApplication(loaded.file, pendingNamespaces)
      : configApplicationName;
  if (configApplicationName === undefined && sourceApplicationName !== undefined) {
    await assertSourceApplication(client, {
      workspaceId: sourceWorkspaceId,
      applicationName: sourceApplicationName,
    });
  }

  const machineUserSource = {
    application: loaded.application,
    config: loaded.config,
    migrationMachineUserOverride: options.machineUser,
  };
  resolveMigrationMachineUsers(machineUserSource, pendingMigrations);

  const baselineSnapshots = await createMigrationTestBaselineSnapshots({
    client,
    workspaceId: sourceWorkspaceId,
    dataMode: options.data,
    inputs,
    baselines,
  });

  const seeds = seedContext ? prepareSeedData(loaded, seedContext, baselines) : [];
  const seedMachineUsers = resolveScriptMachineUsers(
    {
      ...machineUserSource,
      migrationMachineUserOverride: options.machineUser ?? seedContext?.machineUserName,
    },
    seeds.map(({ namespace }) => namespace),
  );
  let assertion: PreparedAssertion | undefined;
  if (options.assertionPath) {
    const namespace = resolveAssertionNamespace(pendingNamespaces, options.assertionNamespace);
    const machineUsers = assertDefined(
      resolveScriptMachineUsers(machineUserSource, [namespace]),
      "assertion machine users missing",
    );
    assertion = {
      namespace,
      invoker: assertDefined(
        machineUsers.byNamespace.get(namespace),
        "assertion machine user missing",
      ),
    };
  }

  const prepared: PreparedMigrationTest = {
    assertion,
    sourceWorkspaceId,
    sourceApplicationName,
    temporaryWorkspace: {
      name: temporaryWorkspaceName(),
      region: sourceWorkspace.region,
      ...temporaryLocation,
    },
    baselines,
    baselineSnapshots,
    targetSnapshots,
    pendingNamespaces,
    ...(designatedTarget
      ? { designatedTarget: { id: designatedTarget.id, region: designatedTarget.region } }
      : {}),
  };
  return {
    state: { client, loaded, options, seeds, seedMachineUsers },
    prepared,
  };
}

/**
 * Create the platform operations used by `tailordb migration test`.
 * @returns Migration test dependencies backed by the Operator API
 */
export function createMigrationTestDependencies(): MigrationTestDependencies {
  let runtimeState: RuntimeState | undefined;
  return {
    prepare: async (options) => {
      const { state, prepared } = await prepareMigrationTest(options);
      runtimeState = state;
      return prepared;
    },
    createWorkspace: async (prepared) => {
      const state = stateOrThrow(runtimeState);
      const workspace = await createValidatedWorkspaceWithClient(
        state.client,
        prepared.temporaryWorkspace,
      );
      logger.info(`Created temporary workspace ${workspace.name} (${workspace.id}).`);
      return {
        id: workspace.id,
        name: workspace.name,
        ...(workspace.createdAt ? { createdAt: workspace.createdAt } : {}),
      };
    },
    recordWorkspaceExpiry: async (workspaceId, ttl, createdAt = new Date()) => {
      const state = stateOrThrow(runtimeState);
      await writeWorkspaceExpiry(
        state.client,
        workspaceId,
        new Date(createdAt.getTime() + parseAge(ttl)),
      );
    },
    deployBaseline: async ({ prepared, targetWorkspaceId }) => {
      const state = stateOrThrow(runtimeState);
      await deleteExistingUserProfileConfig(state, targetWorkspaceId);
      await deployMigrationTestBaseline(
        {
          configPath: state.loaded.config.path,
          profile: state.options.profile,
          workspaceId: targetWorkspaceId,
          yes: true,
        },
        prepared.baselines,
        prepared.baselineSnapshots,
      );
      for (const [namespace, baseline] of prepared.baselines) {
        await updateMigrationLabel(
          state.client,
          targetWorkspaceId,
          namespace,
          baseline.migrationNumber,
          baseline.historyId ?? undefined,
        );
      }
    },
    seedData: async ({ targetWorkspaceId }) => {
      const state = stateOrThrow(runtimeState);
      for (const { namespace, data, order, selfRefTypes, typesWithData } of state.seeds) {
        const machineUsers = assertDefined(state.seedMachineUsers, "seed machine users missing");
        const invoker = assertDefined(
          machineUsers.byNamespace.get(namespace),
          `seed machine user missing for namespace "${namespace}"`,
        );
        const bundled = await bundleSeedScript(
          namespace,
          typesWithData,
          path.dirname(state.loaded.config.path),
          buildOptionsOf(state.loaded.config),
        );
        const chunks = chunkSeedData({
          data,
          order,
          codeByteSize: new TextEncoder().encode(bundled.bundledCode).length,
        });
        for (const chunk of chunks) {
          const execution = await executeScript({
            client: state.client,
            workspaceId: targetWorkspaceId,
            name: `migration-test-seed-${namespace}.ts`,
            code: bundled.bundledCode,
            arg: { data: chunk.data, order: chunk.order, selfRefTypes, upsert: false },
            invoker,
          });
          if (!execution.success) {
            throw CLIError({
              code: "MIGRATION_TEST_SEED_FAILED",
              message: execution.error ?? `Seed execution failed for namespace "${namespace}".`,
            });
          }
          const result = JSON.parse(execution.result || "{}") as { success?: boolean | undefined };
          if (result.success !== true) {
            throw CLIError({
              code: "MIGRATION_TEST_SEED_FAILED",
              message: `Seed execution reported failure for namespace "${namespace}".`,
            });
          }
        }
      }
    },
    cloneData: async ({
      prepared,
      sourceWorkspaceId,
      targetWorkspaceId,
      applicationName,
      cloneTimeout,
    }) => {
      const state = stateOrThrow(runtimeState);
      await assertSourceBaselineFresh(state, prepared, sourceWorkspaceId);
      logger.warn(
        "Clone mode copies TailorDB records only; IdP users and file blobs are not copied.",
      );
      let operationId: string;
      try {
        const response = await state.client.cloneApplicationData({
          sourceWorkspaceId,
          sourceApplicationName: applicationName,
          targetWorkspaceId,
          targetApplicationName: applicationName,
        });
        operationId = response.operationId;
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.Unimplemented) {
          throw CLIError({
            code: "MIGRATION_TEST_CLONE_UNAVAILABLE",
            message: "Application data clone is not enabled for this platform.",
            suggestion: "Retry with --data seed.",
            cause: error,
          });
        }
        throw error;
      }
      if (!operationId) {
        throw internalError("Application data clone returned no operation ID.");
      }
      await waitForCloneApplicationData(state.client, {
        sourceWorkspaceId,
        targetWorkspaceId,
        operationId,
        timeout: cloneTimeout,
      });
    },
    deployMigrations: async ({ prepared, targetWorkspaceId, machineUser }) => {
      const state = stateOrThrow(runtimeState);
      await deployMigrationTestTarget(
        {
          configPath: state.loaded.config.path,
          profile: state.options.profile,
          workspaceId: targetWorkspaceId,
          yes: true,
        },
        prepared.targetSnapshots,
        machineUser,
      );
    },
    runAssertion: async ({ targetWorkspaceId, assertionPath, assertion }) => {
      const state = stateOrThrow(runtimeState);
      const { namespace } = assertion;
      const bundled = await bundleMigrationScript(
        assertionPath,
        namespace,
        0,
        state.loaded.config.env ?? {},
        path.dirname(state.loaded.config.path),
        resolvePluginConfig(state.loaded.plugins, KyselyGeneratorID)?.temporal ?? false,
        effectiveDateDefault(state.loaded.config),
      );
      const execution = await executeScript({
        client: state.client,
        workspaceId: targetWorkspaceId,
        name: `migration-test-assert-${namespace}.ts`,
        code: bundled.bundledCode,
        invoker: assertion.invoker,
      });
      if (!execution.success) {
        throw CLIError({
          code: "MIGRATION_TEST_ASSERTION_FAILED",
          message: execution.error ?? `Migration assertion failed for namespace "${namespace}".`,
        });
      }
    },
    deleteWorkspace: async (workspaceId) => {
      const state = stateOrThrow(runtimeState);
      await state.client.deleteWorkspace({ workspaceId });
    },
  };
}

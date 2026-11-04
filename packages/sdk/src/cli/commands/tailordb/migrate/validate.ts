import * as fs from "node:fs";
import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import {
  assertPendingMigrationsRunnable,
  isScriptBundleFailure,
  pendingMigrationsAfter,
  type MigrationMachineUsers,
} from "#/cli/commands/deploy/tailordb/migration";
import {
  noStepsToSkipError,
  parseMigrationSkipSteps,
  selectSkipStepsOfNamespaces,
} from "#/cli/commands/deploy/tailordb/migration-skip-steps";
import {
  checkMigrationInProgress,
  checkpointRepairInProgressError,
  type MigrationInProgressOutcome,
} from "#/cli/commands/deploy/tailordb/migration-validation";
import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import { deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { serializeError, type errorToJson } from "#/cli/shared/error-json";
import { CLIError, errorSummary, isCLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { PluginManager } from "#/plugin/manager";
import { assertDefined } from "#/utils/assert";
import {
  getNamespacesWithMigrations,
  migrationConfigNotFoundError,
  type NamespaceWithMigrations,
} from "./config";
import {
  formatDiffSummary,
  formatMigrationDiff,
  type MigrationDiff,
  type WarningChangeInfo,
} from "./diff-calculator";
import {
  formatMigrationScriptHint,
  migrationCommandContext,
  type MigrationCommandContext,
} from "./hints";
import { isStaleMigrationInProgress, type RemoteMigrationState } from "./remote-state";
import {
  checkMigrationDiffs,
  logRebaselinePendingGuidance,
  missingCheckpointRecoveryHints,
  logRemoteDriftGuidance,
  toTailorDBDeployInput,
  unsetCheckpointDriftHints,
  verifyRemoteSchema,
  type MigrationCheckResult,
} from "./schema-checks";
import {
  analyzeMigrationScript,
  countUnresolvedTodosInFile,
  ignoredStepsWarning,
  UNRESOLVED_TODO_SUGGESTION,
} from "./script-form";
import {
  assertValidMigrationFiles,
  formatMigrationNumber,
  formatSchemaDrifts,
  getMigrationFilePath,
  getMigrationFiles,
  loadDiff,
  reconstructSnapshotFromMigrations,
} from "./snapshot";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type {
  MigrationInProgress,
  PendingMigration,
  RebaselinePendingInfo,
  RemoteSchemaVerificationResult,
  RemoteSchemaVerificationSkipReason,
  SchemaDrift,
} from "./types";

interface ValidateOptions {
  configPath?: string;
  namespace?: string;
  workspaceId?: string;
  profile?: string;
  json?: boolean;
  strict?: boolean;
  /** Steps a deploy would be asked to skip, keyed by namespace */
  migrationSkipSteps?: ReadonlyMap<string, readonly string[]>;
}

interface MigrationFilesReport {
  valid: boolean;
  error?: string;
}

interface LocalSchemaReport {
  hasDiff: boolean;
  /** Present when local tables drifted from the latest migration snapshot; absent when the drift is a missing snapshot */
  diff?: MigrationDiff;
}

interface CompletedRemoteSchemaReport {
  remoteMigrationNumber: number;
  hasDrift: boolean;
  drifts: SchemaDrift[];
  /** Set when the remote check could not run (namespace not deployed, or no snapshot at the remote migration number) */
  skipped?: RemoteSchemaVerificationSkipReason;
  /** Set when the namespace has tables but no migration checkpoint, so it was checked as checkpoint 0 */
  checkpointUnset?: true;
  /** Set when the remote migration checkpoint does not exist in the local migration history */
  checkpointMissingLocal?: boolean;
  /**
   * Set alongside `checkpointMissingLocal` when the cause is an environment that fell behind
   * before `migration rebaseline` ran, rather than a generic history mismatch.
   */
  rebaselinePending?: RebaselinePendingInfo;
  /** Set alongside `checkpointMissingLocal`: the latest local migration, or `null` when the local history has none */
  localLatestMigration?: number | null;
  /** Set alongside `checkpointMissingLocal`: whether the namespace records another migration history ID, or one that cannot be read */
  historyIdMismatch?: boolean;
  checkpointRepair?: { from: number; to: 0 };
  /** Tables the checkpoint's migration removed that the next deploy deletes */
  unfinishedRemovals?: string[];
  /** Migration whose Pre-phase schema or maintenance mode a deploy left in place without recording it as in progress; the next deploy runs it again */
  interruptedMigration?: number;
}

type FailedRemoteSchemaReport = { skipped: "check_failed" } & {
  [K in Exclude<keyof CompletedRemoteSchemaReport, "skipped">]?: never;
};

type RemoteSchemaReport = CompletedRemoteSchemaReport | FailedRemoteSchemaReport;

interface UnacknowledgedWarningMigration {
  migrationNumber: number;
  warnings: WarningChangeInfo[];
}

interface WarningAcknowledgmentsReport {
  valid: boolean;
  /** Pending migrations with data-loss warnings but no migrate.ts and no recorded acknowledgment */
  missing: UnacknowledgedWarningMigration[];
}

/** A failure as `tailor deploy --json` reports it: without colors, with registered secrets redacted */
type SectionError = ReturnType<typeof errorToJson>["error"];

function sectionError(error: unknown): SectionError {
  return (JSON.parse(serializeError(error)) as ReturnType<typeof errorToJson>).error;
}

interface MigrationInProgressReport {
  /** Whether the next deploy resumes the migration */
  valid: boolean;
  /** The migration an earlier deploy left in progress; absent when its record cannot be read or the checkpoint already covers it */
  migrationNumber?: number;
  /** Why the next deploy would stop, as the deploy reports it */
  error?: SectionError;
}

interface PendingMigrationScriptsReport {
  /** Whether the next deploy can run every pending script, skipping the requested steps */
  valid: boolean;
  /** The pending migrations that have a migrate.ts */
  migrationNumbers: number[];
  /** The machine user that runs the scripts */
  machineUser?: string;
  /** Why the next deploy would stop, as the deploy reports it */
  error?: SectionError;
  /** Set when the check could not run */
  skipped?: "check_failed";
}

interface NamespaceValidationReport {
  namespace: string;
  valid: boolean;
  migrationFiles: MigrationFilesReport;
  /** Omitted when the migration files are invalid (the check cannot run) */
  localSchema?: LocalSchemaReport;
  /** Omitted when the migration files are invalid */
  remoteSchema?: RemoteSchemaReport;
  /**
   * Present when the namespace records a migration in progress; omitted when the remote migration
   * checkpoint is not in the local migration history
   */
  migrationInProgress?: MigrationInProgressReport;
  /**
   * Present when a pending migration has a migrate.ts or --migration-skip-steps names the namespace;
   * omitted when the remote migration checkpoint is unknown or not in the local migration history,
   * or when the in-progress check fails
   */
  pendingMigrationScripts?: PendingMigrationScriptsReport;
  /** Present only with --strict; omitted when the remote migration checkpoint is unknown */
  warningAcknowledgments?: WarningAcknowledgmentsReport;
}

interface BuildValidationReportsOptions {
  targetNamespaces: NamespaceWithMigrations[];
  migrationFileErrors: Map<string, string>;
  localResults: MigrationCheckResult[];
  remoteResults?: RemoteSchemaVerificationResult[];
  inProgressReports?: ReadonlyMap<string, MigrationInProgressReport>;
  scriptReports?: ReadonlyMap<string, PendingMigrationScriptsReport>;
  /** Per-namespace candidates for the --strict warning acknowledgment check */
  unacknowledgedWarnings?: Map<string, UnacknowledgedWarningMigration[]>;
}

interface PendingMigrationChecks {
  client: OperatorClient;
  workspaceId: string;
  application: Pick<Application, "authService" | "env">;
  config: LoadedConfig;
  namespaces: readonly NamespaceWithMigrations[];
  remoteResults: readonly RemoteSchemaVerificationResult[];
  /** Remote migration state of each namespace, as the remote schema check read it */
  remoteStates: ReadonlyMap<string, RemoteMigrationState>;
  /** Steps to skip, keyed by namespace */
  skipSteps: ReadonlyMap<string, readonly string[]>;
  commandContext: MigrationCommandContext;
}

interface NamespacePendingCheck {
  checks: PendingMigrationChecks;
  namespace: string;
  state: RemoteMigrationState;
  /** Migrations after the checkpoint the next deploy uses */
  pending: readonly PendingMigration[];
  checkpointRepaired: boolean;
}

interface NamespaceInProgressResult {
  report?: MigrationInProgressReport;
  /** The record the next deploy resumes */
  resumed?: MigrationInProgress;
}

interface NamespaceScriptsResult {
  report?: PendingMigrationScriptsReport;
  /** Failure that kept the check from running */
  error?: unknown;
}

interface NamespaceScriptsCheck {
  checks: PendingMigrationChecks;
  namespace: string;
  pending: readonly PendingMigration[];
  /** The record the next deploy resumes, which decides how a multi-step script is bundled */
  resumed: MigrationInProgress | undefined;
}

interface PendingMigrationResults {
  inProgressReports: Map<string, MigrationInProgressReport>;
  scriptReports: Map<string, PendingMigrationScriptsReport>;
  /** First failure that kept a check from running */
  error?: unknown;
}

interface CollectedValidationReports {
  reports: NamespaceValidationReport[];
  remoteError?: unknown;
  /** Workspace whose remote schema was checked, when the remote checks ran */
  workspaceId?: string;
}

/**
 * Walk the local migration history once to assert that every required
 * migration script exists, no migration carries both a --no-script
 * acknowledgment and a migrate.ts, and generated normalization logic has
 * been reviewed, and to collect migrations with data-loss warnings that
 * have neither a migrate.ts nor a recorded --no-script acknowledgment
 * @param {string} migrationsDir - Migrations directory path
 * @param {string} namespace - TailorDB namespace (for error messages)
 * @param {string} [configPath] - Config path the current run used (for remediation hints)
 * @returns {UnacknowledgedWarningMigration[]} Unacknowledged warning migrations in the local history
 */
function assertMigrationScriptsReady(
  migrationsDir: string,
  namespace: string,
  configPath?: string,
): UnacknowledgedWarningMigration[] {
  const missing: number[] = [];
  const conflicting: number[] = [];
  const unreviewed: number[] = [];
  const unacknowledgedWarnings: UnacknowledgedWarningMigration[] = [];
  const scriptPaths: [number, string][] = [];
  for (const file of getMigrationFiles(migrationsDir)) {
    if (file.type !== "diff") continue;
    const diff = loadDiff(file.path);
    const migrateFilePath = getMigrationFilePath(migrationsDir, file.number, "migrate");
    const hasScript = fs.existsSync(migrateFilePath);
    if (hasScript) scriptPaths.push([file.number, migrateFilePath]);
    if (diff.requiresMigrationScript && !diff.scriptSkipped && !hasScript) {
      missing.push(file.number);
    }
    if (diff.scriptSkipped && hasScript) {
      conflicting.push(file.number);
    }
    if (hasScript && countUnresolvedTodosInFile(migrateFilePath) > 0) {
      unreviewed.push(file.number);
    }
    if (diff.hasWarnings && !diff.scriptSkipped && !hasScript) {
      unacknowledgedWarnings.push({ migrationNumber: file.number, warnings: diff.warnings });
    }
  }
  if (missing.length > 0) {
    throw CLIError({
      code: "MIGRATION_SCRIPT_REQUIRED",
      message: `Migration(s) ${missing.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" require a migration script but have no migrate.ts.`,
      suggestion:
        "Add one with 'tailor tailordb migration script <number>', or record that no script is needed with 'tailor tailordb migration script <number> --no-script --reason \"...\"'.",
    });
  }
  if (conflicting.length > 0) {
    const clearCommands = conflicting
      .map(
        (migrationNumber) =>
          `  ${formatMigrationScriptHint({ migrationNumber, namespace, configPath })}`,
      )
      .join("\n");
    throw CLIError({
      code: "MIGRATION_SCRIPT_SKIP_CONFLICT",
      message: `Migration(s) ${conflicting.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" have both a --no-script skip acknowledgment and migrate.ts.`,
      suggestion: `Clear the stale acknowledgment(s):\n${clearCommands}\nOr delete migrate.ts to keep the skip.`,
    });
  }
  if (unreviewed.length > 0) {
    throw CLIError({
      code: "MIGRATION_SCRIPT_REVIEW_REQUIRED",
      message: `Migration(s) ${unreviewed.map(formatMigrationNumber).join(", ")} in namespace "${namespace}" still have a TODO() call or review marker in migrate.ts, where the generated script leaves a value or logic for you to decide.`,
      suggestion: UNRESOLVED_TODO_SUGGESTION,
    });
  }
  for (const [migrationNumber, scriptPath] of scriptPaths) {
    const form = analyzeMigrationScript(scriptPath);
    if (form.kind === "main" && form.ignoredSteps) {
      logger.warn(ignoredStepsWarning(`${namespace}/${formatMigrationNumber(migrationNumber)}`));
    }
  }
  return unacknowledgedWarnings;
}

/**
 * Reject --migration-skip-steps entries that validation cannot check against an in-progress
 * migration: for a namespace the config does not define, one without migrations, or one that
 * --namespace leaves out.
 * @param requested - Steps to skip, keyed by namespace
 * @param tailorDBNamespaces - TailorDB namespaces of the config
 * @param migrationNamespaces - Namespaces with migrations configured
 * @param targetNamespace - The --namespace value, if any
 */
function assertSkipStepsCheckable(
  requested: ReadonlyMap<string, readonly string[]>,
  tailorDBNamespaces: ReadonlySet<string>,
  migrationNamespaces: ReadonlySet<string>,
  targetNamespace: string | undefined,
): void {
  for (const [namespace, steps] of requested) {
    if (!tailorDBNamespaces.has(namespace)) {
      const namespaces = [...tailorDBNamespaces];
      throw CLIError({
        code: "MIGRATION_SKIP_STEPS_INVALID",
        message: `Cannot check the steps to skip in namespace '${namespace}': the config defines no TailorDB namespace with that name.`,
        suggestion:
          namespaces.length > 0
            ? `Use one of the config's TailorDB namespaces: ${namespaces.join(", ")}. To check a namespace of another config, run the command with that config.`
            : "The config defines no TailorDB namespace. Remove --migration-skip-steps.",
        context: { namespace, requested: [...steps], namespaces },
      });
    }
    if (!migrationNamespaces.has(namespace)) throw noStepsToSkipError(namespace, steps);
    if (targetNamespace !== undefined && namespace !== targetNamespace) {
      throw CLIError({
        code: "MIGRATION_VALIDATE_OPTIONS_CONFLICT",
        message: `Cannot check the steps to skip in namespace '${namespace}': --namespace limits validation to '${targetNamespace}'.`,
        suggestion:
          "Remove --namespace, or remove the --migration-skip-steps entries of other namespaces.",
        context: { namespace, requested: [...steps] },
      });
    }
  }
}

/**
 * Check one namespace's in-progress record the way a deploy checks it.
 * @param check - The namespace, its remote migration state, and its pending migrations
 * @returns What the next deploy does with the record
 */
async function checkNamespaceInProgress(
  check: NamespacePendingCheck,
): Promise<MigrationInProgressOutcome> {
  const { checks, namespace, state, pending, checkpointRepaired } = check;
  const { client, workspaceId, commandContext } = checks;
  if (checkpointRepaired && (state.inProgress || state.inProgressInvalid)) {
    throw checkpointRepairInProgressError(namespace);
  }
  return await checkMigrationInProgress({
    client,
    workspaceId,
    namespace,
    state,
    next: pending[0],
    commandContext,
  });
}

/**
 * Report one namespace's in-progress record, with the error the next deploy would stop with.
 * @param check - The namespace, its remote migration state, and its pending migrations
 * @returns The namespace's report and the record the next deploy resumes
 */
async function reportNamespaceInProgress(
  check: NamespacePendingCheck,
): Promise<NamespaceInProgressResult> {
  const { state } = check;
  if (!state.inProgress && !state.inProgressInvalid) return {};
  const recorded =
    state.inProgress && !isStaleMigrationInProgress(state)
      ? { migrationNumber: state.inProgress.number }
      : {};
  try {
    const outcome = await checkNamespaceInProgress(check);
    if (outcome.kind !== "resume") return {};
    return {
      report: { valid: true, migrationNumber: outcome.inProgress.number },
      resumed: outcome.inProgress,
    };
  } catch (caught) {
    if (!isCLIError(caught)) throw caught;
    return { report: { valid: false, ...recorded, error: sectionError(caught) } };
  }
}

/**
 * Report whether a deploy can run one namespace's pending migrations: the requested skips apply, a
 * machine user runs the scripts, and each script bundles the way its run executes it.
 * @param check - The namespace's pending migrations and the record the next deploy resumes
 * @returns The namespace's report (absent when it has no pending script and no requested skip) and a failure that kept the check from running
 */
async function reportPendingScripts(check: NamespaceScriptsCheck): Promise<NamespaceScriptsResult> {
  const { checks, namespace, pending, resumed } = check;
  const skipSteps = checks.skipSteps.get(namespace);
  const migrationNumbers = pending
    .filter((migration) => migration.hasScript)
    .map((migration) => migration.number);
  if (migrationNumbers.length === 0 && !skipSteps) return {};
  let machineUsers: MigrationMachineUsers | undefined;
  try {
    machineUsers = await assertPendingMigrationsRunnable({
      client: checks.client,
      workspaceId: checks.workspaceId,
      requested: selectSkipStepsOfNamespaces(checks.skipSteps, [namespace]),
      pendingMigrations: pending,
      inProgressByNamespace: resumed ? { [namespace]: resumed } : {},
      source: { application: checks.application, config: checks.config },
    });
  } catch (caught) {
    if (!isCLIError(caught) && !isScriptBundleFailure(caught)) {
      return { report: { valid: false, migrationNumbers, skipped: "check_failed" }, error: caught };
    }
    return { report: { valid: false, migrationNumbers, error: sectionError(caught) } };
  }
  const machineUser = assertDefined(
    machineUsers?.byNamespace.get(namespace),
    "a namespace whose pending scripts can run has a machine user to run them",
  );
  return { report: { valid: true, migrationNumbers, machineUser } };
}

/**
 * Check each namespace's pending migrations the way a deploy checks them while planning: the
 * in-progress record, then the requested skips and the pending scripts.
 * @param checks - Namespaces and the remote migration state the remote schema check read
 * @returns Per-namespace reports, and the first failure that kept a check from running
 */
async function checkPendingMigrations(
  checks: PendingMigrationChecks,
): Promise<PendingMigrationResults> {
  const inProgressReports = new Map<string, MigrationInProgressReport>();
  const scriptReports = new Map<string, PendingMigrationScriptsReport>();
  let error: unknown;
  for (const { namespace, migrationsDir } of checks.namespaces) {
    const remote = checks.remoteResults.find((result) => result.namespace === namespace);
    const state = assertDefined(
      checks.remoteStates.get(namespace),
      `remote migration state missing for namespace "${namespace}"`,
    );
    if (remote?.checkpointMissingLocal) continue;
    const checkpointRepaired = remote?.checkpointRepair !== undefined;
    const pending = pendingMigrationsAfter(
      namespace,
      migrationsDir,
      remote?.checkpointRepair?.to ?? state.number ?? 0,
    );
    const inProgress = await reportNamespaceInProgress({
      checks,
      namespace,
      state,
      pending,
      checkpointRepaired,
    });
    if (inProgress.report) inProgressReports.set(namespace, inProgress.report);
    if (inProgress.report?.valid === false) continue;
    const scripts = await reportPendingScripts({
      checks,
      namespace,
      pending,
      resumed: inProgress.resumed,
    });
    if (scripts.report) scriptReports.set(namespace, scripts.report);
    error ??= scripts.error;
  }
  return { inProgressReports, scriptReports, ...(error === undefined ? {} : { error }) };
}

/**
 * Build per-namespace reports from the checks that completed
 * @param {BuildValidationReportsOptions} options - Completed validation results
 * @returns {NamespaceValidationReport[]} Validation reports per namespace
 */
function buildValidationReports(
  options: BuildValidationReportsOptions,
): NamespaceValidationReport[] {
  const {
    targetNamespaces,
    migrationFileErrors,
    localResults,
    remoteResults,
    inProgressReports,
    scriptReports,
    unacknowledgedWarnings,
  } = options;

  return targetNamespaces.map((target) => {
    const fileError = migrationFileErrors.get(target.namespace);
    if (fileError !== undefined) {
      return {
        namespace: target.namespace,
        valid: false,
        migrationFiles: { valid: false, error: fileError },
      };
    }

    const local = assertDefined(
      localResults.find((result) => result.namespace === target.namespace),
      `local schema check result missing for namespace "${target.namespace}"`,
    );
    const localSchema: LocalSchemaReport = {
      hasDiff: local.hasDiff,
      ...(local.diff ? { diff: local.diff } : {}),
    };
    if (remoteResults === undefined) {
      return {
        namespace: target.namespace,
        valid: false,
        migrationFiles: { valid: true },
        localSchema,
        remoteSchema: { skipped: "check_failed" },
      };
    }

    const remote = assertDefined(
      remoteResults.find((result) => result.namespace === target.namespace),
      `remote schema check result missing for namespace "${target.namespace}"`,
    );
    const checkpointMissingLocal = remote.checkpointMissingLocal === true;
    const remoteSchema: RemoteSchemaReport = {
      remoteMigrationNumber: remote.remoteMigrationNumber,
      hasDrift: remote.hasDrift,
      drifts: remote.drifts,
      ...(remote.skipped ? { skipped: remote.skipped } : {}),
      ...(remote.checkpointUnset ? { checkpointUnset: true } : {}),
      ...(checkpointMissingLocal ? { checkpointMissingLocal: true } : {}),
      ...(remote.rebaselinePending ? { rebaselinePending: remote.rebaselinePending } : {}),
      ...(remote.localLatestMigration !== undefined
        ? { localLatestMigration: remote.localLatestMigration }
        : {}),
      ...(remote.historyIdMismatch !== undefined
        ? { historyIdMismatch: remote.historyIdMismatch }
        : {}),
      ...(remote.checkpointRepair ? { checkpointRepair: remote.checkpointRepair } : {}),
      ...(remote.unfinishedRemovals?.length
        ? { unfinishedRemovals: remote.unfinishedRemovals }
        : {}),
      ...(remote.interruptedMigration !== undefined
        ? { interruptedMigration: remote.interruptedMigration }
        : {}),
    };

    // Only migrations not yet applied to the remote need an acknowledgment;
    // for applied ones the data is already gone and there is nothing to act on.
    const candidates = unacknowledgedWarnings?.get(target.namespace);
    let warningAcknowledgments: WarningAcknowledgmentsReport | undefined;
    if (candidates !== undefined) {
      const missing = candidates.filter(
        (candidate) => candidate.migrationNumber > remote.remoteMigrationNumber,
      );
      warningAcknowledgments = { valid: missing.length === 0, missing };
    }
    const migrationInProgress = inProgressReports?.get(target.namespace);
    const pendingMigrationScripts = scriptReports?.get(target.namespace);

    return {
      namespace: target.namespace,
      valid:
        !localSchema.hasDiff &&
        !remoteSchema.hasDrift &&
        !checkpointMissingLocal &&
        migrationInProgress?.valid !== false &&
        pendingMigrationScripts?.valid !== false &&
        warningAcknowledgments?.valid !== false,
      migrationFiles: { valid: true },
      localSchema,
      remoteSchema,
      ...(migrationInProgress ? { migrationInProgress } : {}),
      ...(pendingMigrationScripts ? { pendingMigrationScripts } : {}),
      ...(warningAcknowledgments ? { warningAcknowledgments } : {}),
    };
  });
}

/**
 * Run all migration validation checks and collect per-namespace reports
 * @param {ValidateOptions} options - Command options
 * @returns {Promise<CollectedValidationReports>} Validation reports and any remote error
 */
async function collectValidationReports(
  options: ValidateOptions,
): Promise<CollectedValidationReports> {
  const { config, plugins } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  if (namespacesWithMigrations.length === 0) {
    throw migrationConfigNotFoundError();
  }

  const targetNamespaces = options.namespace
    ? namespacesWithMigrations.filter((ns) => ns.namespace === options.namespace)
    : namespacesWithMigrations;
  if (targetNamespaces.length === 0) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_NOT_FOUND",
      message: `Namespace "${options.namespace}" not found or does not have migrations configured`,
    });
  }

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const { defineApplication } = await import("#/cli/services/application");
  const application = defineApplication({ config, pluginManager });
  // Load every namespace (not just the targets): plugins registered while
  // types load may contribute types to the target namespaces.
  for (const service of application.tailorDBServices) {
    await service.loadTypes();
    await service.processNamespacePlugins();
  }
  assertUniqueLocalTailorDBTypeNames({ tailorDBServices: application.tailorDBServices });
  for (const { namespace } of targetNamespaces) {
    if (!application.tailorDBServices.some((s) => s.namespace === namespace)) {
      throw CLIError({
        code: "TAILORDB_NAMESPACE_NOT_FOUND",
        message: `No TailorDB service found for namespace "${namespace}"`,
      });
    }
  }
  const skipSteps = options.migrationSkipSteps ?? new Map<string, readonly string[]>();
  assertSkipStepsCheckable(
    skipSteps,
    new Set(application.tailorDBServices.map((service) => service.namespace)),
    new Set(namespacesWithMigrations.map((target) => target.namespace)),
    options.namespace,
  );
  const tailorDBInputs = application.tailorDBServices.map(toTailorDBDeployInput);
  const typesByNamespace = new Map(tailorDBInputs.map((input) => [input.namespace, input.types]));

  const migrationFileErrors = new Map<string, string>();
  const checkableNamespaces: NamespaceWithMigrations[] = [];
  const unacknowledgedWarnings = options.strict
    ? new Map<string, UnacknowledgedWarningMigration[]>()
    : undefined;
  for (const target of targetNamespaces) {
    try {
      assertValidMigrationFiles(target.migrationsDir, target.namespace, config.path);
      // Parse the whole history here so malformed snapshot/diff contents are
      // reported per namespace instead of aborting the run for every namespace.
      reconstructSnapshotFromMigrations(target.migrationsDir);
      const namespaceWarnings = assertMigrationScriptsReady(
        target.migrationsDir,
        target.namespace,
        options.configPath,
      );
      unacknowledgedWarnings?.set(target.namespace, namespaceWarnings);
      checkableNamespaces.push(target);
    } catch (error) {
      migrationFileErrors.set(target.namespace, errorSummary(error));
    }
  }

  const localResults = await checkMigrationDiffs(typesByNamespace, checkableNamespaces);
  const localReportOptions = {
    targetNamespaces,
    migrationFileErrors,
    localResults,
    ...(unacknowledgedWarnings ? { unacknowledgedWarnings } : {}),
  };

  if (checkableNamespaces.length === 0) {
    return {
      reports: buildValidationReports(localReportOptions),
    };
  }

  let remoteResults: RemoteSchemaVerificationResult[];
  let workspaceId: string;
  let client: OperatorClient;
  const remoteStates = new Map<string, RemoteMigrationState>();
  try {
    const context = await loadOperatorWorkspaceContext({
      profile: options.profile,
      workspaceId: options.workspaceId,
    });
    workspaceId = context.workspaceId;
    client = context.client;
    remoteResults = await verifyRemoteSchema(
      client,
      workspaceId,
      checkableNamespaces,
      config,
      tailorDBInputs,
      { acceptUnfinishedRemovals: true, acceptInterruptedMigration: true, remoteStates },
    );
  } catch (remoteError) {
    return {
      reports: buildValidationReports(localReportOptions),
      remoteError,
    };
  }

  const pending = await checkPendingMigrations({
    client,
    workspaceId,
    application,
    config,
    namespaces: checkableNamespaces,
    remoteResults,
    remoteStates,
    skipSteps,
    commandContext: migrationCommandContext({
      configPath: options.configPath,
      workspaceId,
      profile: options.profile,
    }),
  });

  return {
    reports: buildValidationReports({
      ...localReportOptions,
      remoteResults,
      inProgressReports: pending.inProgressReports,
      scriptReports: pending.scriptReports,
    }),
    workspaceId,
    ...("error" in pending ? { remoteError: pending.error } : {}),
  };
}

function printSectionError(label: string, error: SectionError): void {
  const [first, ...rest] = String(error.message).split("\n");
  logger.log(`  ${label}: ${styles.error(first ?? "")}`);
  const details = typeof error.suggestion === "string" ? error.suggestion.split("\n") : [];
  for (const line of [...rest, ...details]) logger.log(line ? `    ${line}` : "");
}

function printValidationReports(reports: NamespaceValidationReport[]): void {
  for (const report of reports) {
    logger.newline();
    logger.info(`Namespace: ${styles.bold(report.namespace)}`);

    if (!report.migrationFiles.valid) {
      logger.log(`  Migration files: ${styles.error("invalid")}`);
      logger.log(`    ${report.migrationFiles.error}`);
      continue;
    }
    logger.log(`  Migration files: ${styles.success("OK")}`);

    const local = report.localSchema;
    if (local?.hasDiff) {
      if (local.diff) {
        logger.log(`  Local schema: ${styles.error("changes not in migration files")}`);
        logger.log(`    ${formatDiffSummary(local.diff)}`);
        logger.log(formatMigrationDiff(local.diff));
      } else {
        logger.log(`  Local schema: ${styles.error("no migration snapshot found")}`);
      }
    } else {
      logger.log(`  Local schema: ${styles.success("OK")}`);
    }

    const remote = report.remoteSchema;
    if (remote?.skipped === "check_failed") {
      logger.log(`  Remote schema: ${styles.error("not checked")}`);
    } else if (remote?.checkpointRepair) {
      logger.log(
        `  Remote schema: ${styles.success("OK")} (next deploy will reset the checkpoint to 0000 from ${formatMigrationNumber(remote.checkpointRepair.from)})`,
      );
    } else if (remote?.interruptedMigration !== undefined) {
      logger.log(
        `  Remote schema: ${styles.success("OK")} (an earlier deploy left migration ${formatMigrationNumber(remote.interruptedMigration)} without recording it as in progress; the next deploy runs it again from the start)`,
      );
    } else if (remote?.checkpointMissingLocal) {
      logger.log(
        `  Remote schema: ${styles.error(
          `remote migration ${formatMigrationNumber(remote.remoteMigrationNumber)} is not in the local migration history`,
        )}`,
      );
      if (remote.rebaselinePending) {
        logger.log(
          `    Fell behind before 'migration rebaseline' ran; must reach ${formatMigrationNumber(remote.rebaselinePending.replacedLatestMigration)} first.`,
        );
      }
    } else if (remote?.hasDrift) {
      logger.log(
        `  Remote schema: ${styles.error("drift detected")} (${
          remote.checkpointUnset
            ? "no checkpoint yet; compared with 0000"
            : `remote migration: ${formatMigrationNumber(remote.remoteMigrationNumber)}`
        })`,
      );
      logger.log(formatSchemaDrifts(remote.drifts));
    } else if (remote?.skipped === "not_deployed") {
      logger.log(`  Remote schema: ${styles.dim("skipped (namespace not deployed)")}`);
    } else if (remote?.skipped === "no_snapshot") {
      logger.log(
        `  Remote schema: ${styles.dim(`skipped (no local snapshot for remote migration ${formatMigrationNumber(remote.remoteMigrationNumber)})`)}`,
      );
    } else if (remote?.checkpointUnset) {
      logger.log(`  Remote schema: ${styles.success("OK")} (no checkpoint yet; tables match 0000)`);
    } else if (remote) {
      logger.log(
        `  Remote schema: ${styles.success("OK")} (remote migration: ${formatMigrationNumber(remote.remoteMigrationNumber)})`,
      );
    }
    if (remote?.unfinishedRemovals) {
      logger.log(
        `    The next deploy deletes ${remote.unfinishedRemovals.join(", ")}, which migration ${formatMigrationNumber(remote.remoteMigrationNumber)} removed.`,
      );
    }

    const inProgress = report.migrationInProgress;
    if (inProgress?.error) {
      printSectionError("Migration in progress", inProgress.error);
    } else if (inProgress?.migrationNumber !== undefined) {
      logger.log(
        `  Migration in progress: ${styles.success("OK")} (the next deploy resumes ${formatMigrationNumber(inProgress.migrationNumber)})`,
      );
    }

    const scripts = report.pendingMigrationScripts;
    if (scripts?.skipped === "check_failed") {
      logger.log(`  Pending migration scripts: ${styles.error("not checked")}`);
    } else if (scripts?.error) {
      printSectionError("Pending migration scripts", scripts.error);
    } else if (scripts) {
      const migrations = scripts.migrationNumbers.map(formatMigrationNumber).join(", ");
      logger.log(
        `  Pending migration scripts: ${styles.success("OK")} (${migrations} ${scripts.migrationNumbers.length === 1 ? "runs" : "run"} as '${scripts.machineUser}')`,
      );
    }

    const acknowledgments = report.warningAcknowledgments;
    if (acknowledgments) {
      if (acknowledgments.valid) {
        logger.log(`  Warning acknowledgments: ${styles.success("OK")}`);
      } else {
        logger.log(
          `  Warning acknowledgments: ${styles.error("missing for pending migration(s) with possible data loss")}`,
        );
        for (const migration of acknowledgments.missing) {
          const label = formatMigrationNumber(migration.migrationNumber);
          for (const warning of migration.warnings) {
            const field = warning.fieldName ? `.${warning.fieldName}` : "";
            logger.log(`    ${label}: ${warning.tableName}${field}: ${warning.reason}`);
          }
        }
      }
    }
  }
  logger.newline();
}

function hasMissingCheckpoint(
  report: NamespaceValidationReport,
): report is NamespaceValidationReport & {
  remoteSchema: CompletedRemoteSchemaReport & { checkpointMissingLocal: true };
} {
  return report.remoteSchema?.checkpointMissingLocal === true;
}

function remoteDrifts(reports: NamespaceValidationReport[]) {
  return reports.map((report) => ({
    namespace: report.namespace,
    hasDrift: report.remoteSchema?.hasDrift ?? false,
    drifts: report.remoteSchema?.drifts ?? [],
    ...(report.remoteSchema?.checkpointUnset ? { checkpointUnset: true as const } : {}),
  }));
}

function printResolutionHints(
  reports: NamespaceValidationReport[],
  commandContext: MigrationCommandContext,
): void {
  if (reports.some((r) => r.localSchema?.hasDiff && !r.localSchema.diff)) {
    logger.info("Run 'tailor tailordb migration generate' to create the initial snapshot.");
  }
  if (reports.some((r) => r.localSchema?.diff)) {
    logger.info("Run 'tailor tailordb migration generate' to create migration files.");
  }
  logRebaselinePendingGuidance(
    reports.filter(hasMissingCheckpoint).map((r) => ({
      namespace: r.namespace,
      remoteMigrationNumber: r.remoteSchema.remoteMigrationNumber,
      ...(r.remoteSchema.rebaselinePending
        ? { rebaselinePending: r.remoteSchema.rebaselinePending }
        : {}),
    })),
  );
  if (reports.some((r) => r.remoteSchema?.hasDrift)) {
    logRemoteDriftGuidance(commandContext, remoteDrifts(reports));
  }
  const missingAcknowledgments = reports.filter(
    (r) => r.warningAcknowledgments && !r.warningAcknowledgments.valid,
  );
  if (missingAcknowledgments.length > 0) {
    logger.info(
      "For each migration listed, either add a data migration script with 'tailor tailordb migration script <number>' or record why none is needed:",
    );
    for (const report of missingAcknowledgments) {
      for (const migration of report.warningAcknowledgments?.missing ?? []) {
        logger.info(
          `  ${formatMigrationScriptHint({
            migrationNumber: migration.migrationNumber,
            namespace: report.namespace,
            configPath: commandContext.configPath,
            noScript: true,
          })}`,
          { mode: "plain" },
        );
      }
    }
  }
}

/**
 * Validate migration files and schema state without deploying
 * @param {ValidateOptions} options - Command options
 */
async function validate(options: ValidateOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const collected = await collectValidationReports(options);
  const { reports } = collected;
  const invalidCount = reports.filter((r) => !r.valid).length;
  const commandContext = migrationCommandContext({
    configPath: options.configPath,
    workspaceId: collected.workspaceId,
    profile: options.profile,
  });

  if (options.json) {
    logger.out(reports);
  } else {
    printValidationReports(reports);
    if (invalidCount === 0 && !("remoteError" in collected)) {
      logger.success("All migration validation checks passed.");
    } else {
      printResolutionHints(reports, commandContext);
    }
  }

  if ("remoteError" in collected) {
    throw collected.remoteError;
  }
  if (invalidCount > 0) {
    throw CLIError({
      code: "MIGRATION_VALIDATION_FAILED",
      message: `Migration validation failed for ${invalidCount} namespace(s)`,
      suggestion:
        [
          ...missingCheckpointRecoveryHints(
            reports.filter(hasMissingCheckpoint).map((report) => ({
              namespace: report.namespace,
              ...report.remoteSchema,
              localLatestMigration: report.remoteSchema.localLatestMigration ?? null,
              historyIdMismatch: report.remoteSchema.historyIdMismatch ?? false,
            })),
            commandContext,
          ),
          ...unsetCheckpointDriftHints(remoteDrifts(reports), commandContext),
        ].join("\n") || undefined,
    });
  }
}

export const validateCommand = defineAppCommand({
  name: "validate",
  description:
    "Run the migration and schema-drift checks that 'deploy' runs before changing anything, without deploying, and exit with a non-zero code when issues are found.",
  notes: `Migration scripts are checked across the full migration history, not only the pending migrations that \`deploy\` checks. Like \`deploy\`, the command bundles only the pending scripts and checks the machine user that runs them.`,
  args: z.strictObject({
    ...deploymentArgs,
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (validates all namespaces if not specified)",
    }),
    strict: arg(z.boolean().default(false), {
      description: "Also fail when a pending migration can drop data without an acknowledgment",
    }),
    "migration-skip-steps": arg(z.string().optional(), {
      description:
        "Also check that 'deploy --migration-skip-steps' can skip these steps of a partially applied multi-step migration, as comma-separated namespace/step entries",
    }),
  }),
  run: async (args) => {
    await validate({
      configPath: args.config,
      namespace: args.namespace,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      json: logger.jsonMode,
      strict: args.strict,
      migrationSkipSteps: parseMigrationSkipSteps(args["migration-skip-steps"]),
    });
  },
});

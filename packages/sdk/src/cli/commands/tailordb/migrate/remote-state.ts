import { formatConfigArg } from "#/cli/shared/args";
import { getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError, type CLIErrorNextAction, formatCommandHint } from "#/cli/shared/errors";
import { namespaceMigrationArgs, type MigrationCommandContext } from "./hints";
import { formatMigrationNumber } from "./migration-number";
import {
  MAINTENANCE_MODE_LABEL_KEY,
  MIGRATION_EXECUTION_LABEL_KEY,
  MIGRATION_HISTORY_LABEL_KEY,
  MIGRATION_IN_PROGRESS_LABEL_KEY,
  MIGRATION_LABEL_KEY,
  parseExecutionLabel,
  parseInProgressLabel,
  parseMigrationHistoryId,
  parseMigrationLabelNumber,
  type MigrationInProgress,
} from "./types";

export interface RemoteMigrationState {
  metadataExists: boolean;
  number: number | null;
  historyId: string | null;
  historyIdInvalid: boolean;
  inProgress: MigrationInProgress | null;
  /** In-progress labels exist but cannot be read. */
  inProgressInvalid: boolean;
  /** Checkpoint whose tables a deploy left in maintenance mode after committing it. */
  maintenanceModeCheckpoint: number | null;
}

function parseInProgress(labels: Record<string, string>): {
  inProgress: MigrationInProgress | null;
  inProgressInvalid: boolean;
} {
  const migrationLabel = labels[MIGRATION_IN_PROGRESS_LABEL_KEY];
  const executionLabel = labels[MIGRATION_EXECUTION_LABEL_KEY];
  if (migrationLabel === undefined) {
    return { inProgress: null, inProgressInvalid: executionLabel !== undefined };
  }
  const parsed = parseInProgressLabel(migrationLabel);
  const executionId =
    executionLabel === undefined ? undefined : parseExecutionLabel(executionLabel);
  if (parsed === null || executionId === null) {
    return { inProgress: null, inProgressInvalid: true };
  }
  return {
    inProgress: {
      number: parsed.number,
      ...(executionId === undefined ? {} : { executionId }),
      kind: parsed.kind,
    },
    inProgressInvalid: false,
  };
}

/**
 * Fetch the namespace's migration checkpoint, history ID, and any migration
 * left in progress.
 * @param client - Operator client
 * @param trn - Namespace TRN
 * @returns Parsed migration state with invalid history labels kept distinct from missing labels
 */
export async function fetchRemoteMigrationState(
  client: OperatorClient,
  trn: string,
): Promise<RemoteMigrationState> {
  const metadata = await getOrNull(async () => {
    const { metadata } = await client.getMetadata({ trn });
    return metadata;
  });
  if (!metadata) {
    return {
      metadataExists: false,
      number: null,
      historyId: null,
      historyIdInvalid: false,
      inProgress: null,
      inProgressInvalid: false,
      maintenanceModeCheckpoint: null,
    };
  }

  const migrationLabel = metadata.labels[MIGRATION_LABEL_KEY];
  const maintenanceModeLabel = metadata.labels[MAINTENANCE_MODE_LABEL_KEY];
  const historyLabel = metadata.labels[MIGRATION_HISTORY_LABEL_KEY];
  const historyId = historyLabel ? parseMigrationHistoryId(historyLabel) : null;
  return {
    metadataExists: true,
    number: migrationLabel ? parseMigrationLabelNumber(migrationLabel) : null,
    historyId,
    historyIdInvalid: historyLabel !== undefined && historyId === null,
    ...parseInProgress(metadata.labels),
    maintenanceModeCheckpoint: maintenanceModeLabel
      ? parseMigrationLabelNumber(maintenanceModeLabel)
      : null,
  };
}

/** Checkpoint and history ID a deploy expects a namespace to have. */
export type ExpectedMigrationCheckpoint = {
  number: number | null;
  historyId: string | null;
};

/**
 * Whether the namespace still has the checkpoint and history ID a deploy expects.
 * @param remoteState - Remote migration state of the namespace
 * @param expectedCheckpoint - Checkpoint the deploy expects
 * @returns False when either changed, or the history label cannot be read
 */
export function isCheckpointStillOwned(
  remoteState: RemoteMigrationState,
  expectedCheckpoint: ExpectedMigrationCheckpoint,
): boolean {
  return (
    remoteState.number === expectedCheckpoint.number &&
    !remoteState.historyIdInvalid &&
    remoteState.historyId === expectedCheckpoint.historyId
  );
}

/**
 * Whether the namespace records the local migration history, or neither a checkpoint nor a
 * history ID yet.
 * @param state - Remote migration state of the namespace
 * @param localHistoryId - History ID of the local baseline, if it has one
 * @returns False when the namespace records another history, or a history label that cannot be read
 */
export function matchesLocalMigrationHistory(
  state: Pick<RemoteMigrationState, "number" | "historyId" | "historyIdInvalid">,
  localHistoryId: string | null,
): boolean {
  if (state.historyIdInvalid) return false;
  return (state.number === null && state.historyId === null) || state.historyId === localHistoryId;
}

/**
 * Format a namespace's migration history ID for a message, including a label that cannot be read.
 * @param state - Remote migration state of the namespace
 * @returns The history ID, `<invalid>`, or `<unset>`
 */
export function describeMigrationHistoryId(
  state: Pick<RemoteMigrationState, "historyId" | "historyIdInvalid">,
): string {
  return state.historyIdInvalid ? "<invalid>" : (state.historyId ?? "<unset>");
}

type MigrationHistoryMismatch = {
  state: RemoteMigrationState;
  localHistoryId: string | null;
  namespace: string;
  code: string;
  suggestion: string;
};

/**
 * Build the error that refuses a command run from a checkout of another migration history.
 * @param params - Remote state, local history ID, and the refusing command's code and suggestion
 * @returns The error
 */
export function migrationHistoryMismatchError(params: MigrationHistoryMismatch): CLIError {
  const { state, localHistoryId, namespace, code, suggestion } = params;
  return CLIError({
    code,
    message: `The migration history of namespace "${namespace}" on the workspace does not match the local migration history.`,
    details: `The workspace records migration history ID ${describeMigrationHistoryId(state)}; the local migration history has ${localHistoryId ?? "<unset>"}.`,
    suggestion,
    context: {
      namespace,
      remoteHistoryId: state.historyId,
      remoteHistoryIdInvalid: state.historyIdInvalid,
      localHistoryId,
    },
  });
}

type MigrationHistoryWrite = Omit<MigrationHistoryMismatch, "suggestion"> & { force: boolean };

/**
 * Refuse a command that writes the local migration history over a namespace recording another
 * one, unless `--force` asks for the overwrite.
 * @param params - Remote state, local history ID, the refusing command's code, and `--force`
 * @returns The warning naming what `--force` overwrites, when it overwrites another history
 */
export function assertLocalMigrationHistory(params: MigrationHistoryWrite): string | undefined {
  const { force, ...mismatch } = params;
  const { state, localHistoryId } = mismatch;
  if (matchesLocalMigrationHistory(state, localHistoryId)) return undefined;
  if (!force) {
    throw migrationHistoryMismatchError({
      ...mismatch,
      suggestion:
        "Run the command from a checkout of the migration history that was deployed to the workspace, or pass --force to replace it with the local migration history.",
    });
  }
  return `Overwriting the migration history ID ${describeMigrationHistoryId(state)} with ${localHistoryId ?? "<unset>"} (--force).`;
}

/**
 * Format a checkpoint for a message, including a namespace without one.
 * @param number - Checkpoint, if any
 * @returns The formatted number, or `<unset>`
 */
export function describeMigrationCheckpoint(number: number | null | undefined): string {
  return number == null ? "<unset>" : formatMigrationNumber(number);
}

/**
 * Whether the in-progress record names a migration the checkpoint already
 * covers, so it no longer describes the namespace.
 * @param state - Checkpoint and in-progress record of the namespace
 * @returns True for a leftover record
 */
export function isStaleMigrationInProgress(
  state: Pick<RemoteMigrationState, "number" | "inProgress">,
): boolean {
  return (
    state.inProgress !== null && state.number !== null && state.inProgress.number <= state.number
  );
}

/** How `migration resolve` settles a migration left in progress. */
export type MigrationResolution = "rollback" | "complete";

/**
 * Arguments of the `tailor` command that settles a namespace's migration left in progress.
 * @param resolution - How to settle it
 * @param namespace - TailorDB namespace
 * @param context - Config and workspace selection of the current run
 * @returns Command arguments
 */
export function migrationResolveArgs(
  resolution: MigrationResolution,
  namespace: string,
  context: MigrationCommandContext,
): string[] {
  return namespaceMigrationArgs({
    ...context,
    subcommand: ["resolve", `--${resolution}`],
    namespace,
  });
}

/**
 * Render the command that settles a namespace's migration left in progress, for an error suggestion.
 * @param resolution - How to settle it
 * @param namespace - TailorDB namespace
 * @param context - Config and workspace selection of the current run
 * @returns The command, as rendered by `formatCommandHint`
 */
export function formatMigrationResolveHint(
  resolution: MigrationResolution,
  namespace: string,
  context: MigrationCommandContext,
): string {
  return formatCommandHint({
    command: "tailor",
    args: migrationResolveArgs(resolution, namespace, context),
  });
}

/**
 * Describe how to settle a `main` run whose outcome an earlier deploy did not settle.
 * @param namespace - TailorDB namespace
 * @param context - Config and workspace selection of the current run
 * @returns Both commands, each with the outcome it applies to
 */
export function describeMainRunSettlement(
  namespace: string,
  context: MigrationCommandContext,
): string {
  return (
    `Settle it with ${formatMigrationResolveHint("complete", namespace, context)} if its run succeeded, ` +
    `or with ${formatMigrationResolveHint("rollback", namespace, context)} otherwise; ` +
    "the command shows the outcome of the run before it changes anything."
  );
}

/** A command that continues or settles a migration left in progress, and what it does. */
export type InProgressMigrationAction = CLIErrorNextAction & {
  action: "resume" | MigrationResolution;
  description: string;
};

type InProgressMigrationActionsParams = MigrationCommandContext & {
  state: Pick<RemoteMigrationState, "number" | "inProgress">;
  namespace: string;
};

/**
 * List the commands that continue or settle the migration a namespace records as in progress:
 * a deploy resumes one whose steps partly committed, and `migration resolve` rolls it back or
 * completes it.
 * @param params - Migration state, namespace, and the invocation context to keep in each command
 * @returns The commands, or none when no migration is in progress or the record does not follow
 *   the checkpoint, which both commands refuse
 */
export function inProgressMigrationActions(
  params: InProgressMigrationActionsParams,
): InProgressMigrationAction[] {
  const { state, namespace, ...context } = params;
  const record = state.inProgress;
  if (!record || record.number !== (state.number ?? 0) + 1) return [];
  const configArg = formatConfigArg(context.configPath);
  const invocationArgs = [
    ...(configArg === undefined ? [] : [configArg]),
    ...(context.contextArgs ?? []),
  ];
  const label = formatMigrationNumber(record.number);
  const previousLabel = formatMigrationNumber(record.number - 1);
  const settleAction = (resolution: MigrationResolution, description: string) => ({
    action: resolution,
    description,
    command: "tailor",
    args: migrationResolveArgs(resolution, namespace, context),
  });
  if (record.kind === "main") {
    return [
      settleAction(
        "complete",
        `applies the schema of migration ${label} without running its script again; use it when the run succeeded`,
      ),
      settleAction(
        "rollback",
        `returns to the schema of migration ${previousLabel}, and the next deploy runs its script again; use it when the run did not succeed`,
      ),
    ];
  }
  return [
    {
      action: "resume",
      description: "steps that already completed do not run again",
      command: "tailor",
      args: ["deploy", ...invocationArgs],
    },
    settleAction(
      "rollback",
      `returns to the schema of migration ${previousLabel}, and the next deploy runs every step again`,
    ),
    settleAction(
      "complete",
      `applies the schema of migration ${label} without running its script again`,
    ),
  ];
}

const IN_PROGRESS_ACTION_LABELS: Record<InProgressMigrationAction["action"], string> = {
  resume: "Resume",
  rollback: "Roll back",
  complete: "Complete",
};

/**
 * Format a command that continues or settles a migration left in progress as one line.
 * @param action - The command and what it does
 * @returns The line
 */
export function formatInProgressMigrationAction(action: InProgressMigrationAction): string {
  return `${IN_PROGRESS_ACTION_LABELS[action.action]}: ${formatCommandHint(action)} (${action.description})`;
}

/**
 * Refuse a command that rewrites migration state while a migration is
 * partially applied, which only a deploy or `migration resolve` can finish
 * consistently, or its `main` run is unsettled, which only `migration resolve`
 * can settle consistently.
 * @param state - Remote migration state of the namespace
 * @param namespace - TailorDB namespace
 * @param context - Config and workspace selection of the current run
 */
export function assertNoMigrationInProgress(
  state: RemoteMigrationState,
  namespace: string,
  context: MigrationCommandContext,
): void {
  if (!state.inProgress && !state.inProgressInvalid) return;
  const migrationLabel = state.inProgress
    ? `${namespace}/${formatMigrationNumber(state.inProgress.number)}`
    : undefined;
  const actions = inProgressMigrationActions({ ...context, state, namespace });
  throw CLIError({
    code: "MIGRATION_IN_PROGRESS",
    message: !state.inProgress
      ? `Namespace "${namespace}" records a partially applied migration that cannot be read.`
      : state.inProgress.kind === "main"
        ? `The outcome of the run of migration ${migrationLabel} that an earlier deploy started is not settled.`
        : `Migration ${migrationLabel} is partially applied by an earlier deploy.`,
    suggestion:
      actions.length > 0
        ? [
            "Continue or settle the migration first with one of these commands:",
            ...actions.map((action) => `- ${formatInProgressMigrationAction(action)}`),
          ].join("\n")
        : state.inProgress?.kind === "main"
          ? describeMainRunSettlement(namespace, context)
          : "Finish the migration with a deploy first; steps that already completed do not run again.",
  });
}

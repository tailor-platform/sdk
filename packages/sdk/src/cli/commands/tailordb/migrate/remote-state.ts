import { getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
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
  /** Set when the deploy read a history label it could not parse. */
  historyIdInvalid?: boolean;
};

/**
 * Whether the namespace still has the checkpoint and history ID a deploy expects.
 * @param remoteState - Remote migration state of the namespace
 * @param expectedCheckpoint - Checkpoint the deploy expects
 * @returns False when either changed, or the history label cannot be read when the deploy read one it could
 */
export function isCheckpointStillOwned(
  remoteState: RemoteMigrationState,
  expectedCheckpoint: ExpectedMigrationCheckpoint,
): boolean {
  return (
    remoteState.number === expectedCheckpoint.number &&
    remoteState.historyIdInvalid === (expectedCheckpoint.historyIdInvalid ?? false) &&
    remoteState.historyId === expectedCheckpoint.historyId
  );
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
 * @returns Command arguments
 */
export function migrationResolveArgs(resolution: MigrationResolution, namespace: string): string[] {
  return ["tailordb", "migration", "resolve", `--${resolution}`, "--namespace", namespace];
}

/**
 * Quote the command that settles a namespace's migration left in progress, for an error suggestion.
 * @param resolution - How to settle it
 * @param namespace - TailorDB namespace
 * @returns The quoted command
 */
export function formatMigrationResolveHint(
  resolution: MigrationResolution,
  namespace: string,
): string {
  return `'tailor ${migrationResolveArgs(resolution, namespace).join(" ")}'`;
}

/**
 * Describe how to settle a `main` run whose outcome an earlier deploy did not settle.
 * @param namespace - TailorDB namespace
 * @returns Both commands, each with the outcome it applies to
 */
export function describeMainRunSettlement(namespace: string): string {
  return (
    `Settle it with ${formatMigrationResolveHint("complete", namespace)} if its run succeeded, ` +
    `or with ${formatMigrationResolveHint("rollback", namespace)} otherwise; ` +
    "the command shows the outcome of the run before it changes anything."
  );
}

/**
 * Refuse a command that rewrites migration state while a migration is
 * partially applied, which only a deploy or `migration resolve` can finish
 * consistently, or its `main` run is unsettled, which only `migration resolve`
 * can settle consistently.
 * @param state - Remote migration state of the namespace
 * @param namespace - TailorDB namespace
 */
export function assertNoMigrationInProgress(state: RemoteMigrationState, namespace: string): void {
  if (!state.inProgress && !state.inProgressInvalid) return;
  const migrationLabel = state.inProgress
    ? `${namespace}/${formatMigrationNumber(state.inProgress.number)}`
    : undefined;
  throw CLIError({
    code: "MIGRATION_IN_PROGRESS",
    message: !state.inProgress
      ? `Namespace "${namespace}" records a partially applied migration that cannot be read.`
      : state.inProgress.kind === "main"
        ? `The outcome of the run of migration ${migrationLabel} that an earlier deploy started is not settled.`
        : `Migration ${migrationLabel} is partially applied by an earlier deploy.`,
    suggestion:
      state.inProgress?.kind === "main"
        ? describeMainRunSettlement(namespace)
        : "Finish the migration with a deploy first; steps that already completed do not run again.",
  });
}

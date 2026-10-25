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
} from "./types";

/** A migration an earlier deploy left partially applied, or whose `main` run it left unsettled. */
export interface MigrationInProgress {
  number: number;
  /** The run to resume or settle; absent when the deploy stopped before recording it. */
  executionId?: string;
  /**
   * Set when the record is of a run of the whole script as one job, as a `main` script runs.
   * A deploy does not resume such a run; `migration resolve` settles it.
   */
  main?: true;
}

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
      ...(parsed.main ? { main: true } : {}),
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

/**
 * Whether the in-progress record names a migration the checkpoint already
 * covers, so it no longer describes the namespace.
 * @param state - Remote migration state of the namespace
 * @returns True for a leftover record
 */
export function isStaleMigrationInProgress(state: RemoteMigrationState): boolean {
  return (
    state.inProgress !== null && state.number !== null && state.inProgress.number <= state.number
  );
}

/**
 * Describe how to settle a `main` run whose outcome an earlier deploy did not settle.
 * @param namespace - TailorDB namespace
 * @returns Both commands, each with the outcome it applies to
 */
export function describeMainRunSettlement(namespace: string): string {
  return (
    `Settle it with 'tailor tailordb migration resolve --complete --namespace ${namespace}' if its run succeeded, ` +
    `or with 'tailor tailordb migration resolve --rollback --namespace ${namespace}' otherwise; ` +
    "the command shows the outcome of the run before it changes anything."
  );
}

/**
 * Refuse a command that rewrites migration state while a migration is
 * partially applied, or its `main` run is unsettled; only a deploy or
 * `migration resolve` can finish it consistently.
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
      : state.inProgress.main
        ? `The outcome of the run of migration ${migrationLabel} that an earlier deploy started is not settled.`
        : `Migration ${migrationLabel} is partially applied by an earlier deploy.`,
    suggestion: state.inProgress?.main
      ? describeMainRunSettlement(namespace)
      : "Finish the migration with a deploy first; steps that already completed do not run again.",
  });
}

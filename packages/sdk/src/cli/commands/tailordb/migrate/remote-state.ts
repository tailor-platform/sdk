import { getOrNull, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { formatMigrationNumber } from "./migration-number";
import {
  MIGRATION_EXECUTION_LABEL_KEY,
  MIGRATION_HISTORY_LABEL_KEY,
  MIGRATION_IN_PROGRESS_LABEL_KEY,
  MIGRATION_LABEL_KEY,
  parseExecutionLabel,
  parseMigrationHistoryId,
  parseMigrationLabelNumber,
} from "./types";

/** A migration an earlier deploy left partially applied. */
export interface MigrationInProgress {
  number: number;
  /** The run to resume; absent when the deploy stopped before recording it. */
  executionId?: string;
}

export interface RemoteMigrationState {
  metadataExists: boolean;
  number: number | null;
  historyId: string | null;
  historyIdInvalid: boolean;
  inProgress: MigrationInProgress | null;
  /** In-progress labels exist but cannot be read. */
  inProgressInvalid: boolean;
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
  const number = parseMigrationLabelNumber(migrationLabel);
  const executionId =
    executionLabel === undefined ? undefined : parseExecutionLabel(executionLabel);
  if (number === null || executionId === null) {
    return { inProgress: null, inProgressInvalid: true };
  }
  return {
    inProgress: executionId === undefined ? { number } : { number, executionId },
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
    };
  }

  const migrationLabel = metadata.labels[MIGRATION_LABEL_KEY];
  const historyLabel = metadata.labels[MIGRATION_HISTORY_LABEL_KEY];
  const historyId = historyLabel ? parseMigrationHistoryId(historyLabel) : null;
  return {
    metadataExists: true,
    number: migrationLabel ? parseMigrationLabelNumber(migrationLabel) : null,
    historyId,
    historyIdInvalid: historyLabel !== undefined && historyId === null,
    ...parseInProgress(metadata.labels),
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
 * Refuse a command that rewrites migration state while a migration is
 * partially applied; only a deploy can finish it consistently.
 * @param state - Remote migration state of the namespace
 * @param namespace - TailorDB namespace
 */
export function assertNoMigrationInProgress(state: RemoteMigrationState, namespace: string): void {
  if (!state.inProgress && !state.inProgressInvalid) return;
  throw CLIError({
    code: "MIGRATION_IN_PROGRESS",
    message: state.inProgress
      ? `Migration ${namespace}/${formatMigrationNumber(state.inProgress.number)} is partially applied by an earlier deploy.`
      : `Namespace "${namespace}" records a partially applied migration that cannot be read.`,
    suggestion:
      "Finish the migration with a deploy first; steps that already completed do not run again.",
  });
}

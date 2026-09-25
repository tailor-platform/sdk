import { getOrNull, type OperatorClient } from "#/cli/shared/client";
import {
  MIGRATION_HISTORY_LABEL_KEY,
  MIGRATION_LABEL_KEY,
  parseMigrationHistoryId,
  parseMigrationLabelNumber,
} from "./types";

export interface RemoteMigrationState {
  metadataExists: boolean;
  number: number | null;
  historyId: string | null;
  historyIdInvalid: boolean;
}

/**
 * Fetch the namespace's migration checkpoint and history ID.
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
  };
}

/**
 * Fetch the namespace's current migration number from its metadata labels.
 *
 * Only a namespace that has not been deployed yet reads as "no current
 * migration". Every other lookup failure must propagate: treating it as
 * unset would misreport a transient error as "no checkpoint", showing
 * every migration as pending to callers.
 * @param client - Operator client
 * @param trn - Namespace TRN
 * @returns Parsed current migration number, or null when unset or unparseable
 */
export async function fetchRemoteMigrationNumber(
  client: OperatorClient,
  trn: string,
): Promise<number | null> {
  return (await fetchRemoteMigrationState(client, trn)).number;
}

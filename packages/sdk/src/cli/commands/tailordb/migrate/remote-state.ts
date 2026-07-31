import { getOrNull, type OperatorClient } from "#/cli/shared/client";
import { MIGRATION_LABEL_KEY, parseMigrationLabelNumber } from "./types";

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
  const metadata = await getOrNull(async () => {
    const { metadata } = await client.getMetadata({ trn });
    return metadata;
  });
  const label = metadata?.labels[MIGRATION_LABEL_KEY];
  return label ? parseMigrationLabelNumber(label) : null;
}

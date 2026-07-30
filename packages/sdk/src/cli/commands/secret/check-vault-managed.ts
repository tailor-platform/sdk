import {
  resourceTrn,
  sdkAppIdLabelKey,
  sdkNameLabelKey,
  sdkVersionLabelKey,
  writeMetadataLabels,
} from "#/cli/commands/deploy/label";
import { logger } from "#/cli/shared/logger";
import type { OperatorClient } from "#/cli/shared/client";

type CheckVaultManagedParams = {
  client: OperatorClient;
  workspaceId: string;
  vaultName: string;
};

type CheckVaultManagedResult = {
  isManaged: boolean;
  trn: string;
  existingLabels: Record<string, string>;
};

/**
 * Check if a vault is managed by defineSecretManager() and warn the user.
 * Returns management status and metadata needed for releasing ownership.
 * @param params - Check parameters
 * @returns Management status, TRN, and existing labels
 */
export async function checkVaultManaged(
  params: CheckVaultManagedParams,
): Promise<CheckVaultManagedResult> {
  const { client, workspaceId, vaultName } = params;
  const trn = resourceTrn(workspaceId, "vault", vaultName);
  const notManaged = { isManaged: false, trn, existingLabels: {} };

  let owner: string | undefined;
  let allLabels: Record<string, string>;
  try {
    const { metadata } = await client.getMetadata({ trn });
    allLabels = metadata?.labels ?? {};
    owner = allLabels[sdkNameLabelKey];
  } catch {
    // If metadata fetch fails (e.g., vault doesn't exist yet), proceed silently.
    // The actual operation will surface the appropriate error.
    return notManaged;
  }

  if (!owner) return notManaged;

  logger.warn(
    `Vault "${vaultName}" is managed by defineSecretManager() in tailor.config.ts (owner: "${owner}"). ` +
      `Changes made via CLI may conflict with the config on the next apply.`,
  );

  return { isManaged: true, trn, existingLabels: allLabels };
}

/**
 * Release ownership of a managed vault by removing SDK labels from metadata.
 * Call this after the user has confirmed they want to proceed with a CLI operation on a managed vault.
 * The labels are read again at write time, so the caller does not pass the ones
 * `checkVaultManaged` saw: anything written since then is kept, and only the
 * ownership labels are removed.
 *
 * That includes the app id, which decides ownership on its own: leaving it
 * behind would keep the vault SDK-owned, and the next deploy of a config that
 * no longer declares it would delete the vault and every secret in it.
 * @param params - Client and TRN from the checkVaultManaged result
 * @param params.client - Operator client used to update vault metadata
 * @param params.trn - TRN of the vault resource
 */
export async function releaseVaultOwnership(params: {
  client: OperatorClient;
  trn: string;
}): Promise<void> {
  const { client, trn } = params;
  await writeMetadataLabels(client, {
    trn,
    remove: [sdkNameLabelKey, sdkVersionLabelKey, sdkAppIdLabelKey],
  });
  logger.info(
    "Config ownership has been removed from this vault. " +
      "Remove it from defineSecretManager() in your config to prevent the next apply from re-claiming it.",
  );
}

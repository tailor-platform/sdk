import { resourceTrn, sdkNameLabelKey } from "@/cli/commands/deploy/label";
import { logger } from "@/cli/shared/logger";
import type { OperatorClient } from "@/cli/shared/client";

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
 * @param params - Client, TRN, and existing labels from checkVaultManaged result
 * @param params.client - Operator client used to update vault metadata
 * @param params.trn - TRN of the vault resource
 * @param params.existingLabels - Existing metadata labels on the vault before release
 */
export async function releaseVaultOwnership(params: {
  client: OperatorClient;
  trn: string;
  existingLabels: Record<string, string>;
}): Promise<void> {
  const { client, trn, existingLabels } = params;
  const { [sdkNameLabelKey]: _, "sdk-version": __, ...remainingLabels } = existingLabels;
  await client.setMetadata({ trn, labels: remainingLabels });
  logger.info(
    "Config ownership has been removed from this vault. " +
      "Remove it from defineSecretManager() in your config to prevent the next apply from re-claiming it.",
  );
}

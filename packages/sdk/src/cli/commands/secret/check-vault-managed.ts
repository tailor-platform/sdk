import { sdkNameLabelKey, trnPrefix } from "@/cli/commands/apply/label";
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
  const trn = `${trnPrefix(workspaceId)}:vault:${vaultName}`;
  const notManaged = { isManaged: false, trn, existingLabels: {} };

  let owner: string | undefined;
  let allLabels: Record<string, string> = {};
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
      `Proceeding will release ownership so the vault is no longer managed by config.`,
  );

  return { isManaged: true, trn, existingLabels: allLabels };
}

/**
 * Release ownership of a managed vault by removing SDK labels from metadata.
 * Call this after the user has confirmed they want to proceed with a CLI operation on a managed vault.
 * @param params - Client, TRN, and existing labels from checkVaultManaged result
 * @param params.client
 * @param params.trn
 * @param params.existingLabels
 */
export async function releaseVaultOwnership(params: {
  client: OperatorClient;
  trn: string;
  existingLabels: Record<string, string>;
}): Promise<void> {
  const { client, trn, existingLabels } = params;
  const { [sdkNameLabelKey]: _, "sdk-version": __, ...remainingLabels } = existingLabels;
  await client.setMetadata({ trn, labels: remainingLabels });
  logger.info("Vault ownership released. It will no longer be managed by config.");
}

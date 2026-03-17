import { sdkNameLabelKey, trnPrefix } from "@/cli/commands/apply/label";
import { logger } from "@/cli/shared/logger";
import type { OperatorClient } from "@/cli/shared/client";

type CheckVaultManagedParams = {
  client: OperatorClient;
  workspaceId: string;
  vaultName: string;
};

/**
 * Check if a vault is managed by defineSecretManager() and warn the user.
 * Returns true if the vault is managed, false otherwise.
 * @param params - Check parameters
 * @returns Whether the vault is managed by config
 */
export async function checkVaultManaged(params: CheckVaultManagedParams): Promise<boolean> {
  const { client, workspaceId, vaultName } = params;
  const trn = `${trnPrefix(workspaceId)}:vault:${vaultName}`;

  let owner: string | undefined;
  try {
    const { metadata } = await client.getMetadata({ trn });
    owner = metadata?.labels[sdkNameLabelKey];
  } catch {
    // If metadata fetch fails (e.g., vault doesn't exist yet), proceed silently.
    // The actual operation will surface the appropriate error.
    return false;
  }

  if (!owner) return false;

  logger.warn(
    `Vault "${vaultName}" is managed by defineSecretManager() in tailor.config.ts (owner: "${owner}"). ` +
      `Changes made via CLI will be overwritten on the next apply. ` +
      `To manage this vault via CLI, remove it from the config and run apply first.`,
  );

  return true;
}

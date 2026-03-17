import { sdkNameLabelKey, trnPrefix } from "@/cli/commands/apply/label";
import { logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import type { OperatorClient } from "@/cli/shared/client";

type ManagedVaultGuardParams = {
  client: OperatorClient;
  workspaceId: string;
  vaultName: string;
  yes?: boolean;
  /** When true, only show the warning without prompting for confirmation. */
  warnOnly?: boolean;
};

/**
 * Check if a vault is managed by defineSecretManager() and warn the user.
 * If managed, shows a warning and asks for confirmation before proceeding.
 * When `warnOnly` is true, shows the warning but skips the confirmation prompt
 * (useful when the caller has its own confirmation step).
 * @param params - Guard parameters
 * @returns Whether to proceed with the operation
 */
export async function managedVaultGuard(params: ManagedVaultGuardParams): Promise<boolean> {
  const { client, workspaceId, vaultName, yes, warnOnly } = params;
  const trn = `${trnPrefix(workspaceId)}:vault:${vaultName}`;

  let owner: string | undefined;
  try {
    const { metadata } = await client.getMetadata({ trn });
    owner = metadata?.labels[sdkNameLabelKey];
  } catch {
    // If metadata fetch fails (e.g., vault doesn't exist yet), proceed silently.
    // The actual operation will surface the appropriate error.
    return true;
  }

  if (!owner) return true;

  logger.warn(
    `Vault "${vaultName}" is managed by defineSecretManager() in tailor.config.ts (owner: "${owner}"). ` +
      `Changes made via CLI will be overwritten on the next apply. ` +
      `To manage this vault via CLI, remove it from the config and run apply first.`,
  );

  if (warnOnly || yes) return true;

  const confirmed = await prompt.confirm({
    message: "Do you want to proceed?",
    default: false,
  });
  return confirmed;
}

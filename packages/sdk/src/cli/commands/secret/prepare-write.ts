import { CLIError } from "#/cli/shared/errors";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { checkVaultManaged } from "./check-vault-managed";

interface SecretWriteArgs {
  profile?: string;
  "workspace-id"?: string;
  "vault-name": string;
  yes: boolean;
}

/**
 * Resolve the workspace and confirm a write to a managed vault.
 * @param args - Workspace and confirmation options
 * @param operation - Secret command performing the write
 * @returns Workspace context for the confirmed write
 */
export async function prepareSecretWrite(args: SecretWriteArgs, operation: "create" | "update") {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: args.profile,
    workspaceId: args["workspace-id"],
  });
  const managed = await checkVaultManaged({ client, workspaceId, vaultName: args["vault-name"] });
  if (managed.isManaged && !args.yes) {
    const confirmed = await prompt.confirm({ message: "Do you want to proceed?", default: false });
    if (!confirmed) {
      const action = operation === "create" ? "creation" : "update";
      throw CLIError({
        code: operation === "create" ? "SECRET_CREATION_CANCELLED" : "SECRET_UPDATE_CANCELLED",
        message: `Secret ${action} cancelled. The vault is still managed by the config.`,
      });
    }
  }
  return { client, workspaceId, managed };
}

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { vaultArgs } from "./args";
import type { SecretManagerSecret } from "@tailor-proto/tailor/v1/secret_manager_resource_pb";

export interface SecretListOptions {
  workspaceId?: string;
  profile?: string;
  vaultName: string;
}

export interface SecretInfo {
  name: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function secretInfo(secret: SecretManagerSecret): SecretInfo {
  return {
    name: secret.name,
    createdAt: secret.createTime ? timestampDate(secret.createTime) : null,
    updatedAt: secret.updateTime ? timestampDate(secret.updateTime) : null,
  };
}

/**
 * List secrets in a Secret Manager vault.
 * @param options - Secret listing options
 * @returns List of secrets
 */
async function secretList(options: SecretListOptions): Promise<SecretInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const secrets = await fetchAll(async (pageToken, maxPageSize) => {
    const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
      workspaceId,
      secretmanagerVaultName: options.vaultName,
      pageToken,
      pageSize: maxPageSize,
    });
    return [secrets, nextPageToken];
  });

  return secrets.map(secretInfo);
}

export const listSecretCommand = defineAppCommand({
  name: "list",
  description: "List all secrets in a vault.",
  args: z
    .object({
      ...workspaceArgs,
      ...vaultArgs,
    })
    .strict(),
  run: async (args) => {
    try {
      const secrets = await secretList({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        vaultName: args["vault-name"],
      });
      logger.out(secrets);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Vault "${args["vault-name"]}" not found.`, { cause: error });
      }
      throw error;
    }
  },
});

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#src/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { vaultArgs } from "./args";
import type { SecretManagerSecret } from "@tailor-platform/tailor-proto/secret_manager_resource_pb";

export interface SecretListOptions {
  workspaceId?: string;
  profile?: string;
  vaultName: string;
  order?: Order;
  limit?: number;
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
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const pageDirection = toPageDirection(options.order);
  const secrets = await fetchPaged(
    async (pageToken, pageSize) => {
      const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
        workspaceId,
        secretmanagerVaultName: options.vaultName,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [secrets, nextPageToken];
    },
    { limit: options.limit },
  );

  return secrets.map(secretInfo);
}

export const listSecretCommand = defineAppCommand({
  name: "list",
  description: "List all secrets in a vault.",
  args: z
    .object({
      ...workspaceArgs,
      ...vaultArgs,
      ...paginationArgs(),
    })
    .strict(),
  run: async (args) => {
    try {
      const secrets = await secretList({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        vaultName: args["vault-name"],
        order: args.order,
        limit: args.limit,
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

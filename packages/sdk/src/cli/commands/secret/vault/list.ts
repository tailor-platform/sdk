import { timestampDate } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { type Order, paginationArgs, workspaceArgs } from "@/cli/shared/args";
import { fetchPaged, initOperatorClient, toPageDirection } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { SecretManagerVault } from "@tailor-proto/tailor/v1/secret_manager_resource_pb";

export interface VaultListOptions {
  workspaceId?: string;
  profile?: string;
  order?: Order;
  limit?: number;
}

export interface VaultInfo {
  name: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function vaultInfo(vault: SecretManagerVault): VaultInfo {
  return {
    name: vault.name,
    createdAt: vault.createTime ? timestampDate(vault.createTime) : null,
    updatedAt: vault.updateTime ? timestampDate(vault.updateTime) : null,
  };
}

/**
 * List Secret Manager vaults in the workspace.
 * @param options - Vault listing options
 * @returns List of vaults
 */
async function vaultList(options?: VaultListOptions): Promise<VaultInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const pageDirection = toPageDirection(options?.order);
  const vaults = await fetchPaged(
    async (pageToken, pageSize) => {
      const { vaults, nextPageToken } = await client.listSecretManagerVaults({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [vaults, nextPageToken];
    },
    { limit: options?.limit },
  );

  return vaults.map(vaultInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all Secret Manager vaults in the workspace.",
  args: z
    .object({
      ...workspaceArgs,
      ...paginationArgs,
    })
    .strict(),
  run: async (args) => {
    const vaults = await vaultList({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    logger.out(vaults);
  },
});

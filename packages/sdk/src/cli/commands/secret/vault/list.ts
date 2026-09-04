import { timestampDate } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import type { SecretManagerVault } from "@tailor-platform/tailor-proto/secret_manager_resource_pb";

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
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
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
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
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

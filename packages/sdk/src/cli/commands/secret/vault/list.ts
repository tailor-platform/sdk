import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { SecretManagerVault } from "@tailor-proto/tailor/v1/secret_manager_resource_pb";

export interface VaultListOptions {
  workspaceId?: string;
  profile?: string;
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
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const vaults = await fetchAll(async (pageToken, maxPageSize) => {
    const { vaults, nextPageToken } = await client.listSecretManagerVaults({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [vaults, nextPageToken];
  });

  return vaults.map(vaultInfo);
}

export const listCommand = defineCommand({
  name: "list",
  description: "List all Secret Manager vaults in the workspace.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  }),
  run: withCommonArgs(async (args) => {
    const vaults = await vaultList({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.out(vaults);
  }),
});

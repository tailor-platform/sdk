import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../../args";
import { fetchAll, initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger } from "../../utils/logger";
import type { SecretManagerVault } from "@tailor-proto/tailor/v1/secret_manager_resource_pb";

export interface VaultListOptions {
  workspaceId?: string;
  profile?: string;
}

export interface VaultInfo {
  name: string;
  createdAt: string;
  updatedAt: string;
}

function vaultInfo(vault: SecretManagerVault): VaultInfo {
  return {
    name: vault.name,
    createdAt: vault.createTime ? timestampDate(vault.createTime).toISOString() : "N/A",
    updatedAt: vault.updateTime ? timestampDate(vault.updateTime).toISOString() : "N/A",
  };
}

/**
 * List Secret Manager vaults in the workspace.
 * @param [options] - Vault listing options
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

  const vaults = await fetchAll(async (pageToken) => {
    const { vaults, nextPageToken } = await client.listSecretManagerVaults({
      workspaceId,
      pageToken,
    });
    return [vaults, nextPageToken];
  });

  return vaults.map(vaultInfo);
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List Secret Manager vaults",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  },
  run: withCommonArgs(async (args) => {
    const vaults = await vaultList({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.out(vaults);
  }),
});

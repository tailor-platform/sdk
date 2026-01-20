import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { vaultArgs } from "./args";
import type { SecretManagerSecret } from "@tailor-proto/tailor/v1/secret_manager_resource_pb";

export interface SecretListOptions {
  workspaceId?: string;
  profile?: string;
  vaultName: string;
}

export interface SecretInfo {
  name: string;
  createdAt: string;
  updatedAt: string;
}

function secretInfo(secret: SecretManagerSecret): SecretInfo {
  return {
    name: secret.name,
    createdAt: secret.createTime ? timestampDate(secret.createTime).toISOString() : "N/A",
    updatedAt: secret.updateTime ? timestampDate(secret.updateTime).toISOString() : "N/A",
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
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const secrets = await fetchAll(async (pageToken) => {
    const { secrets, nextPageToken } = await client.listSecretManagerSecrets({
      workspaceId,
      secretmanagerVaultName: options.vaultName,
      pageToken,
    });
    return [secrets, nextPageToken];
  });

  return secrets.map(secretInfo);
}

export const listSecretCommand = defineCommand({
  meta: {
    name: "list",
    description: "List secrets in a vault",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    ...vaultArgs,
  },
  run: withCommonArgs(async (args) => {
    try {
      const secrets = await secretList({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        vaultName: args["vault-name"],
      });
      logger.out(secrets);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Vault "${args["vault-name"]}" not found.`);
      }
      throw error;
    }
  }),
});

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { parseFormat, printWithFormat } from "../format";
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
    createdAt: secret.createTime
      ? timestampDate(secret.createTime).toISOString()
      : "N/A",
    updatedAt: secret.updateTime
      ? timestampDate(secret.updateTime).toISOString()
      : "N/A",
  };
}

export async function secretList(
  options: SecretListOptions,
): Promise<SecretInfo[]> {
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
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
    },
    "vault-name": {
      type: "string",
      description: "Vault name",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
    const format = parseFormat(args.json);

    try {
      const secrets = await secretList({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        vaultName: args["vault-name"],
      });
      printWithFormat(secrets, format);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Vault "${args["vault-name"]}" not found.`);
      }
      throw error;
    }
  }),
});

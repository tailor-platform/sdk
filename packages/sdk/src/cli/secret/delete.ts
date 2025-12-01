import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";

export const deleteSecretCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a secret in a vault",
  },
  args: {
    ...commonArgs,
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
    name: {
      type: "string",
      description: "Secret name",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    await client.deleteSecretManagerSecret({
      workspaceId,
      secretmanagerVaultName: args["vault-name"],
      secretmanagerSecretName: args.name,
    });

    consola.success(
      `Secret: ${args.name} deleted from vault: ${args["vault-name"]}`,
    );
  }),
});

import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create a Secret Manager vault",
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
    name: {
      type: "string",
      description: "Vault name",
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

    await client.createSecretManagerVault({
      workspaceId,
      secretmanagerVaultName: args.name,
    });

    consola.success(`Vault: ${args.name} created`);
  }),
});

import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";

export const createSecretCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create a secret in a vault",
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
    value: {
      type: "string",
      description: "Secret value",
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

    await client.createSecretManagerSecret({
      workspaceId,
      secretmanagerVaultName: args["vault-name"],
      secretmanagerSecretName: args.name,
      secretmanagerSecretValue: args.value,
    });

    consola.success(
      `Secret: ${args.name} created in vault: ${args["vault-name"]}`,
    );
  }),
});

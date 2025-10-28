import { defineCommand } from "citty";
import { consola } from "consola";
import { validate as uuidValidate } from "uuid";

import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { readTailorctlConfig } from "../tailorctl";

export const destroyCommand = defineCommand({
  meta: {
    name: "destroy",
    description: "Destroy a Tailor Platform workspace",
  },
  args: {
    ...commonArgs,
    "workspace-id": {
      type: "string",
      description: "ID of the workspace to destroy",
      required: true,
      alias: "w",
    },
  },
  run: withCommonArgs(async (args) => {
    const tailorctlConfig = readTailorctlConfig();
    const client = await initOperatorClient(tailorctlConfig);

    // Validate inputs
    if (!uuidValidate(args["workspace-id"])) {
      consola.error(`Invalid workspace ID: Must be a valid UUID.`);
      process.exit(1);
    }

    await client.deleteWorkspace({
      workspaceId: args["workspace-id"],
    });
    consola.success(
      `Workspace "${args["workspace-id"]}" destroyed successfully.`,
    );
  }),
});

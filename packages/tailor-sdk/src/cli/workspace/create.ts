import { defineCommand } from "citty";
import { consola } from "consola";
import { validate as uuidValidate } from "uuid";

import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { readTailorctlConfig } from "../tailorctl";

const validateName = (name: string) => {
  if (name.length < 3 || name.length > 63) {
    return "Name must be between 3 and 63 characters long.";
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "Name can only contain lowercase letters, numbers, and hyphens.";
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return "Name cannot start or end with a hyphen.";
  }
};

const validateRegion = async (region: string, client: OperatorClient) => {
  const availableRegions = await client.listAvailableWorkspaceRegions({});
  if (!availableRegions.regions.includes(region)) {
    return `Region must be one of: ${availableRegions.regions.join(", ")}`;
  }
};

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create a new Tailor Platform workspace",
  },
  args: {
    ...commonArgs,
    name: {
      type: "string",
      description: "Name of the workspace",
      required: true,
      alias: "n",
    },
    region: {
      type: "string",
      description: "Region of the workspace (us-west, asia-northeast)",
      required: true,
      alias: "r",
    },
    "delete-protection": {
      type: "boolean",
      description: "Enable delete protection for the workspace",
      alias: "d",
      default: false,
    },
    "organization-id": {
      type: "string",
      description: "Organization ID to associate the workspace with",
      alias: "o",
    },
    "folder-id": {
      type: "string",
      description: "Folder ID to associate the workspace with",
      alias: "f",
    },
  },
  run: withCommonArgs(async (args) => {
    const tailorctlConfig = readTailorctlConfig();
    const client = await initOperatorClient(tailorctlConfig);

    // Validate inputs
    const nameErr = validateName(args.name);
    if (nameErr) {
      consola.error(`Invalid name: ${nameErr}`);
      process.exit(1);
    }
    const regionError = await validateRegion(args.region, client);
    if (regionError) {
      consola.error(`Invalid region: ${regionError}`);
      process.exit(1);
    }
    if (args["organization-id"] && !uuidValidate(args["organization-id"])) {
      consola.error(`Invalid organization ID: Must be a valid UUID.`);
      process.exit(1);
    }
    if (args["folder-id"] && !uuidValidate(args["folder-id"])) {
      consola.error(`Invalid folder ID: Must be a valid UUID.`);
      process.exit(1);
    }

    await client.createWorkspace({
      workspaceName: args.name,
      workspaceRegion: args.region,
      deleteProtection: args["delete-protection"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });
    consola.success(`Workspace "${args.name}" created successfully.`);
  }),
});

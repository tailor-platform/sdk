import { defineCommand } from "citty";
import { consola } from "consola";
import { validate as uuidValidate } from "uuid";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { workspaceInfo } from "./transform";

const validateName = (name: string) => {
  if (name.length < 3 || name.length > 63) {
    throw new Error(`Name must be between 3 and 63 characters long.`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(
      "Name can only contain lowercase letters, numbers, and hyphens.",
    );
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    throw new Error("Name cannot start or end with a hyphen.");
  }
};

const validateRegion = async (region: string, client: OperatorClient) => {
  const availableRegions = await client.listAvailableWorkspaceRegions({});
  if (!availableRegions.regions.includes(region)) {
    throw new Error(
      `Region must be one of: ${availableRegions.regions.join(", ")}.`,
    );
  }
};

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create new workspace",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
    name: {
      type: "string",
      description: "Workspace name",
      required: true,
      alias: "n",
    },
    region: {
      type: "string",
      description: "Workspace region (us-west, asia-northeast)",
      required: true,
      alias: "r",
    },
    "delete-protection": {
      type: "boolean",
      description: "Enable delete protection",
      alias: "d",
      default: false,
    },
    "organization-id": {
      type: "string",
      description: "Organization ID to workspace associate with",
    },
    "folder-id": {
      type: "string",
      description: "Folder ID to workspace associate with",
    },
  },
  run: withCommonArgs(async (args) => {
    const accessToken = await loadAccessToken();
    const client = await initOperatorClient(accessToken);

    // Validate args
    const format = parseFormat(args.format);
    validateName(args.name);
    await validateRegion(args.region, client);
    if (args["organization-id"] && !uuidValidate(args["organization-id"])) {
      throw new Error(`Organization ID must be a valid UUID.`);
    }
    if (args["folder-id"] && !uuidValidate(args["folder-id"])) {
      throw new Error(`Folder ID must be a valid UUID.`);
    }

    const resp = await client.createWorkspace({
      workspaceName: args.name,
      workspaceRegion: args.region,
      deleteProtection: args["delete-protection"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });
    if (format === "table") {
      consola.success(`Workspace "${args.name}" created successfully.`);
    }

    // Show workspace info
    printWithFormat(workspaceInfo(resp.workspace!), format);
  }),
});

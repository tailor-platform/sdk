import { defineCommand } from "citty";
import { consola } from "consola";
import { validate as validateUuid } from "uuid";
import {
  commonArgs,
  jsonArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { workspaceInfo, type WorkspaceInfo } from "./transform";

export interface WorkspaceCreateOptions {
  name: string;
  region: string;
  deleteProtection?: boolean;
  organizationId?: string;
  folderId?: string;
}

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

export async function workspaceCreate(
  options: WorkspaceCreateOptions,
): Promise<WorkspaceInfo> {
  // Load and validate options
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  validateName(options.name);
  await validateRegion(options.region, client);
  const deleteProtection = options.deleteProtection ?? false;
  if (options.organizationId && !validateUuid(options.organizationId)) {
    throw new Error(`Organization ID must be a valid UUID.`);
  }
  if (options.folderId && !validateUuid(options.folderId)) {
    throw new Error(`Folder ID must be a valid UUID.`);
  }

  // Create workspace
  const resp = await client.createWorkspace({
    workspaceName: options.name,
    workspaceRegion: options.region,
    deleteProtection,
    organizationId: options.organizationId,
    folderId: options.folderId,
  });

  return workspaceInfo(resp.workspace!);
}

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create new workspace",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
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
      alias: "o",
    },
    "folder-id": {
      type: "string",
      description: "Folder ID to workspace associate with",
      alias: "f",
    },
  },
  run: withCommonArgs(async (args) => {
    // Validate CLI specific args
    const format = parseFormat(args.json);

    // Execute workspace create logic
    const workspace = await workspaceCreate({
      name: args.name,
      region: args.region,
      deleteProtection: args["delete-protection"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });

    // Show success message for table format
    if (format === "table") {
      consola.success(`Workspace "${args.name}" created successfully.`);
    }

    // Show workspace info
    printWithFormat(workspace, format);
  }),
});

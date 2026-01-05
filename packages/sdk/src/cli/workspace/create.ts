import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken, loadFolderId, loadOrganizationId } from "../context";
import { logger } from "../utils/logger";
import { workspaceInfo, type WorkspaceInfo } from "./transform";

/**
 * Schema for workspace creation options
 * - name: 3-63 chars, lowercase alphanumeric and hyphens, cannot start/end with hyphen
 * - organizationId, folderId: optional UUIDs
 */
const createWorkspaceOptionsSchema = z.object({
  name: z
    .string()
    .min(3, "Name must be at least 3 characters")
    .max(63, "Name must be at most 63 characters")
    .regex(/^[a-z0-9-]+$/, "Name can only contain lowercase letters, numbers, and hyphens")
    .refine(
      (n) => !n.startsWith("-") && !n.endsWith("-"),
      "Name cannot start or end with a hyphen",
    ),
  region: z.string(),
  deleteProtection: z.boolean().optional(),
  organizationId: z.uuid().optional(),
  folderId: z.uuid().optional(),
});

export type CreateWorkspaceOptions = z.input<typeof createWorkspaceOptionsSchema>;

const validateRegion = async (region: string, client: OperatorClient) => {
  const availableRegions = await client.listAvailableWorkspaceRegions({});
  if (!availableRegions.regions.includes(region)) {
    throw new Error(`Region must be one of: ${availableRegions.regions.join(", ")}.`);
  }
};

export async function createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceInfo> {
  // Validate options with zod schema
  const result = createWorkspaceOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }
  const validated = result.data;

  // Load client and validate region
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  await validateRegion(validated.region, client);

  // Resolve organization and folder IDs from options or environment variables
  const organizationId = loadOrganizationId(validated.organizationId);
  const folderId = loadFolderId(validated.folderId);

  // Create workspace
  const resp = await client.createWorkspace({
    workspaceName: validated.name,
    workspaceRegion: validated.region,
    deleteProtection: validated.deleteProtection ?? false,
    organizationId,
    folderId,
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
    // Execute workspace create logic
    const workspace = await createWorkspace({
      name: args.name,
      region: args.region,
      deleteProtection: args["delete-protection"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });

    if (!args.json) {
      logger.success(`Workspace "${args.name}" created successfully.`);
    }

    logger.out(workspace);
  }),
});

import { arg } from "politty";
import { z } from "zod";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import {
  workspaceDisplayName,
  workspaceInfoWithFolderName,
  workspaceNameTransformer,
  type WorkspaceInfo,
} from "./transform";
import type { ProfileInfo } from "../profile";

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

/**
 * Create a new workspace with the given options.
 * @param options - Workspace creation options
 * @returns Created workspace info
 */
export async function createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceInfo> {
  // Validate options with zod schema
  const result = createWorkspaceOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }
  const validated = result.data;

  // Load client and validate region
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  await validateRegion(validated.region, client);

  // Create workspace
  const resp = await client.createWorkspace({
    workspaceName: validated.name,
    workspaceRegion: validated.region,
    deleteProtection: validated.deleteProtection ?? false,
    organizationId: validated.organizationId,
    folderId: validated.folderId,
  });

  return workspaceInfoWithFolderName(
    client,
    assertDefined(resp.workspace, "createWorkspace response missing workspace"),
  );
}

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new Tailor Platform workspace.",
  args: z.strictObject({
    name: arg(z.string(), {
      alias: "n",
      description: "Workspace name",
    }),
    region: arg(z.string(), {
      alias: "r",
      description: "Workspace region (us-west, asia-northeast)",
    }),
    "delete-protection": arg(z.boolean().default(false), {
      alias: "d",
      description: "Enable delete protection",
    }),
    "organization-id": arg(z.string().optional(), {
      alias: "o",
      description: "Organization ID to workspace associate with",
      env: "TAILOR_PLATFORM_ORGANIZATION_ID",
    }),
    "folder-id": arg(z.string().optional(), {
      alias: "f",
      description: "Folder ID to workspace associate with",
      env: "TAILOR_PLATFORM_FOLDER_ID",
    }),
    "profile-name": arg(z.string().optional(), {
      alias: "p",
      description: "Profile name to create",
    }),
    "profile-user": arg(z.string().optional(), {
      description: "User email for the profile (defaults to current user)",
    }),
    permission: arg(z.enum(["write", "read"]).default("write"), {
      description:
        "Profile permission (requires --profile-name). 'read' blocks all write commands while the profile is active.",
    }),
  }),
  run: async (args) => {
    // This command does not expose `--profile`, so the guard resolves the
    // active profile from `TAILOR_PLATFORM_PROFILE` only.
    await assertWritable();
    // Execute workspace create logic
    const workspace = await createWorkspace({
      name: args.name,
      region: args.region,
      deleteProtection: args["delete-protection"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });

    let profileInfo: ProfileInfo | undefined;
    const profileName = args["profile-name"];
    if (profileName) {
      const config = await readPlatformConfig();
      if (config.profiles[profileName]) {
        throw new Error(`Profile "${profileName}" already exists.`);
      }

      const profileUser = args["profile-user"] || config.current_user;
      if (!profileUser) {
        throw new Error(
          "Current user not found. Please login or specify --profile-user to create a profile.",
        );
      }

      if (!config.users[profileUser]) {
        throw new Error(
          `User "${profileUser}" not found.\nPlease verify your user name and login using 'tailor-sdk login' command.`,
        );
      }
      config.profiles[profileName] = {
        user: profileUser,
        workspace_id: workspace.id,
        ...(args.permission === "read" ? { readonly: true } : {}),
      };
      writePlatformConfig(config);
      profileInfo = {
        name: profileName,
        user: profileUser,
        workspaceId: workspace.id,
        permission: args.permission,
      };

      if (!args.json) {
        logger.success(`Profile "${profileName}" created successfully.`);
      }
    }

    if (!args.json) {
      logger.success(`Workspace "${workspaceDisplayName(workspace)}" created successfully.`);
    }

    if (args.json && profileInfo) {
      logger.out({ ...workspace, profile: profileInfo });
      return;
    }

    logger.out(workspace, { display: { name: workspaceNameTransformer, folderName: null } });
    if (profileInfo) {
      logger.out("Profile:");
      logger.out(profileInfo);
    }
  },
});

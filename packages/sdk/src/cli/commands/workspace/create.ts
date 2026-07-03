import { arg } from "politty";
import { z } from "zod";
import {
  getConsoleBaseUrl,
  getOAuth2ClientId,
  getPlatformBaseUrl,
  initOperatorClient,
  isDefaultPlatform,
  type OperatorClient,
  type PlatformClientConfig,
} from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  loadAccessToken,
  platformConfigFromProfile,
  readPlatformConfig,
  resolveConfigUser,
  writePlatformConfig,
} from "#/cli/shared/context";
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
// strip unknown keys
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

function profilePlatformSettings(platformConfig?: PlatformClientConfig) {
  const hasOAuth2ClientId =
    platformConfig?.oauth2ClientId || process.env.TAILOR_PLATFORM_OAUTH2_CLIENT_ID;
  const hasConsoleUrl = platformConfig?.consoleUrl || process.env.TAILOR_PLATFORM_CONSOLE_URL;

  return {
    ...(isDefaultPlatform(platformConfig)
      ? {}
      : { platform_url: getPlatformBaseUrl(platformConfig) }),
    ...(hasOAuth2ClientId ? { oauth2_client_id: getOAuth2ClientId(platformConfig) } : {}),
    ...(hasConsoleUrl ? { console_url: getConsoleBaseUrl(platformConfig) } : {}),
  };
}

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
      description:
        "User email address or machine user client ID for the profile (defaults to current user)",
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
    const profileName = args["profile-name"];
    let profileSetup:
      | {
          name: string;
          user: string;
          platformSettings: ReturnType<typeof profilePlatformSettings>;
        }
      | undefined;
    if (profileName) {
      const config = await readPlatformConfig();
      if (config.profiles[profileName]) {
        throw new Error(`Profile "${profileName}" already exists.`);
      }

      const activeProfileName = process.env.TAILOR_PLATFORM_PROFILE;
      const activeProfileEntry = activeProfileName ? config.profiles[activeProfileName] : undefined;
      const platformConfig = activeProfileEntry
        ? platformConfigFromProfile(activeProfileEntry)
        : undefined;
      const profileUser = args["profile-user"] || activeProfileEntry?.user || config.current_user;
      if (!profileUser) {
        throw new Error(
          "Current user not found. Please login or specify --profile-user to create a profile.",
        );
      }

      const resolvedProfileUser = resolveConfigUser(config, profileUser, platformConfig);
      if (!resolvedProfileUser) {
        throw new Error(
          `User "${profileUser}" not found.\nPlease verify your user name and login using 'tailor login' command.`,
        );
      }
      profileSetup = {
        name: profileName,
        user: resolvedProfileUser,
        platformSettings: profilePlatformSettings(platformConfig),
      };
    }

    // Execute workspace create logic
    const workspace = await createWorkspace({
      name: args.name,
      region: args.region,
      deleteProtection: args["delete-protection"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
    });

    let profileInfo: ProfileInfo | undefined;
    if (profileSetup) {
      const config = await readPlatformConfig();
      const platformSettings = profileSetup.platformSettings;
      config.profiles[profileSetup.name] = {
        user: profileSetup.user,
        workspace_id: workspace.id,
        ...(args.permission === "read" ? { readonly: true } : {}),
        ...platformSettings,
      };
      writePlatformConfig(config);
      profileInfo = {
        name: profileSetup.name,
        user: profileSetup.user,
        workspaceId: workspace.id,
        permission: args.permission,
        ...(platformSettings.platform_url ? { platformUrl: platformSettings.platform_url } : {}),
        ...(platformSettings.oauth2_client_id
          ? { oauth2ClientId: platformSettings.oauth2_client_id }
          : {}),
        ...(platformSettings.console_url ? { consoleUrl: platformSettings.console_url } : {}),
      };

      if (!args.json) {
        logger.success(`Profile "${profileSetup.name}" created successfully.`);
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

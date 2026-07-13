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
  hasUserTokenEntry,
  loadAccessToken,
  loadPlatformClientConfig,
  platformConfigFromProfile,
  readPlatformConfig,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { workspaceNameSchema } from "#/cli/shared/workspace-name";
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
  name: workspaceNameSchema,
  region: z.string(),
  deleteProtection: z.boolean().optional(),
  organizationId: z.uuid().optional(),
  folderId: z.uuid().optional(),
  profile: z.string().optional(),
});

export type CreateWorkspaceOptions = z.input<typeof createWorkspaceOptionsSchema>;
export type ValidatedCreateWorkspaceOptions = z.output<typeof createWorkspaceOptionsSchema>;

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
  const validated = validateCreateWorkspaceOptions(options);
  const accessToken = await loadAccessToken({ profile: validated.profile });
  const platformConfig = await loadPlatformClientConfig({ profile: validated.profile });
  const client = await initOperatorClient(accessToken, platformConfig);
  await validateRegion(validated.region, client);
  return createValidatedWorkspaceWithClient(client, validated);
}

/**
 * Create a workspace after its local options and region have been validated.
 * @param client - Authenticated Operator client
 * @param options - Validated workspace creation options
 * @returns Created workspace info
 */
export async function createValidatedWorkspaceWithClient(
  client: OperatorClient,
  options: ValidatedCreateWorkspaceOptions,
): Promise<WorkspaceInfo> {
  // Create workspace
  const resp = await client.createWorkspace({
    workspaceName: options.name,
    workspaceRegion: options.region,
    deleteProtection: options.deleteProtection ?? false,
    organizationId: options.organizationId,
    folderId: options.folderId,
  });

  return workspaceInfoWithFolderName(
    client,
    assertDefined(resp.workspace, "createWorkspace response missing workspace"),
  );
}

/**
 * Validate workspace creation options without making API calls.
 * @param options - Workspace creation options
 * @returns Validated workspace creation options
 */
export function validateCreateWorkspaceOptions(
  options: CreateWorkspaceOptions,
): ValidatedCreateWorkspaceOptions {
  const result = createWorkspaceOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }
  return result.data;
}

export { validateWorkspaceName } from "#/cli/shared/workspace-name";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new Tailor Platform workspace.",
  args: z
    .object({
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
      profile: arg(z.string().optional(), {
        description: "Workspace profile used for authentication and Platform selection",
        env: "TAILOR_PLATFORM_PROFILE",
      }),
      "profile-user": arg(z.string().optional(), {
        description: "User email for the profile (defaults to current user)",
      }),
      permission: arg(z.enum(["write", "read"]).default("write"), {
        description:
          "Profile permission (requires --profile-name). 'read' blocks all write commands while the profile is active.",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
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

      const activeProfileName = args.profile;
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

      if (!hasUserTokenEntry(config, profileUser, platformConfig)) {
        throw new Error(
          `User "${profileUser}" not found.\nPlease verify your user name and login using 'tailor-sdk login' command.`,
        );
      }
      profileSetup = {
        name: profileName,
        user: profileUser,
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
      profile: args.profile,
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

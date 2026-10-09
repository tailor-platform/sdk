import { arg } from "@politty/zod";
import { z } from "zod";
import { recoveryContextArgs, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import {
  platformConfigFromProfile,
  readEnvironmentToken,
  readPlatformConfig,
  resolveUserTokenKey,
  writePlatformConfig,
} from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import ml from "#/utils/multiline";

const defaultIdSchema = z.union([z.uuid(), z.literal("")]);

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Set the current user's default organization and folder for new workspaces.",
  notes: ml`
    \`workspace create\` creates a workspace in the default folder, or directly under the default organization when no folder is set. Giving --organization-id or --folder-id to \`workspace create\`, on the command line or through TAILOR_PLATFORM_ORGANIZATION_ID / TAILOR_PLATFORM_FOLDER_ID, replaces both defaults for that run. The defaults are not used while TAILOR_PLATFORM_TOKEN is set, because that token does not belong to a user logged in here.

    Each run replaces both defaults: --default-organization-id alone clears the default folder, --default-folder-id is accepted only together with --default-organization-id, and --default-organization-id "" clears both. The IDs are not checked against the Platform here; \`workspace create\` points back to them when the Platform cannot find them or denies access to them.

    The defaults belong to this user's login on the selected platform, so \`logout\` removes them, and older SDK versions drop them when they rewrite the CLI config file.
  `,
  args: z.strictObject({
    "default-organization-id": arg(defaultIdSchema.optional(), {
      alias: "o",
      description:
        "Organization that `workspace create` uses when no location is given. Pass an empty string to clear the defaults.",
    }),
    "default-folder-id": arg(defaultIdSchema.optional(), {
      alias: "f",
      description:
        "Folder in the default organization that `workspace create` uses (requires --default-organization-id)",
    }),
    profile: workspaceArgs.profile,
  }),
  run: async (args) => {
    const organizationId = args["default-organization-id"];
    const folderId = args["default-folder-id"];
    if (organizationId === undefined && folderId === undefined) {
      throw CLIError({
        code: "USER_UPDATE_EMPTY",
        message: "Please provide at least one property to update.",
        command: "user update",
      });
    }
    if (organizationId === undefined || (organizationId === "" && folderId)) {
      throw CLIError({
        code: "USER_DEFAULT_FOLDER_WITHOUT_ORGANIZATION",
        message: "--default-folder-id requires a --default-organization-id.",
        suggestion: "Pass the organization that owns the folder with --default-organization-id.",
        command: "user update",
      });
    }

    const config = await readPlatformConfig();
    const profileName = args.profile || process.env.TAILOR_PLATFORM_PROFILE;
    const profileEntry = profileName ? config.profiles[profileName] : undefined;
    if (profileName && !profileEntry) {
      throw CLIError({ code: "PROFILE_NOT_FOUND", message: `Profile "${profileName}" not found` });
    }
    const login = {
      command: "tailor",
      args: ["login", ...recoveryContextArgs({ profile: profileName })],
    };
    const user = profileEntry ? profileEntry.user : config.current_user;
    if (!user) {
      throw CLIError({
        code: "USER_NOT_SET",
        message: "Current user not set.",
        suggestion: "Log in first to register a user.",
        next: login,
      });
    }
    const platformConfig = profileEntry ? platformConfigFromProfile(profileEntry) : undefined;
    const userKey = resolveUserTokenKey(config, user, platformConfig, {
      allowLegacyUserKey: false,
    });
    const entry = config.users[userKey];
    if (!entry) {
      throw CLIError({
        code: "USER_NOT_FOUND",
        message: `User "${user}" has no login of its own on the selected platform.`,
        suggestion: "Log in on that platform to store the defaults with that login.",
        next: login,
      });
    }

    const previousOrganizationId = entry.default_organization_id ?? null;
    const previousFolderId = entry.default_folder_id ?? null;
    delete entry.default_organization_id;
    delete entry.default_folder_id;
    if (organizationId) {
      entry.default_organization_id = organizationId;
      if (folderId) entry.default_folder_id = folderId;
    }
    writePlatformConfig(config);

    const defaultOrganizationId = entry.default_organization_id ?? null;
    const defaultFolderId = entry.default_folder_id ?? null;
    logger.success(
      defaultOrganizationId
        ? `Default organization for new workspaces set to ${defaultOrganizationId} ${
            defaultFolderId ? `with folder ${defaultFolderId}` : "with no default folder"
          }.`
        : "Default organization and folder for new workspaces cleared.",
    );
    if (defaultOrganizationId && readEnvironmentToken()) {
      logger.warn(
        "`workspace create` does not use these defaults while TAILOR_PLATFORM_TOKEN is set.",
      );
    }
    printMutationResult({
      changed:
        previousOrganizationId !== defaultOrganizationId || previousFolderId !== defaultFolderId,
      user,
      profile: profileName || null,
      defaultOrganizationId,
      defaultFolderId,
    });
  },
});

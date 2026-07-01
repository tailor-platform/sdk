import { arg } from "politty";
import { z } from "zod";
import { fetchAll, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  fetchLatestToken,
  platformConfigFromProfile,
  readPlatformConfig,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import type { ProfileInfo } from "./types";

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update profile properties.",
  args: z.strictObject({
    name: arg(z.string(), {
      positional: true,
      description: "Profile name",
    }),
    user: arg(z.string().optional(), {
      alias: "u",
      description: "New user email address or machine user client ID",
    }),
    "workspace-id": arg(z.string().optional(), {
      alias: "w",
      description: "New workspace ID",
    }),
    permission: arg(z.enum(["write", "read"]).optional(), {
      description:
        "Profile permission. 'read' blocks all write commands; 'write' lifts the restriction.",
    }),
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Default machine user name for application-data commands (query, workflow start, function test-run, machineuser token). Pass an empty string to clear.",
    }),
    "machine-user-override": arg(z.enum(["allow", "deny"]).optional(), {
      description:
        "Whether the command line or TAILOR_PLATFORM_MACHINE_USER_NAME may override the profile's machine user. 'deny' requires --machine-user; 'allow' lifts the restriction.",
    }),
    "platform-url": arg(z.union([z.url(), z.literal("")]).optional(), {
      description: "Platform API base URL for this profile. Pass an empty string to clear.",
    }),
    "oauth2-client-id": arg(z.string().optional(), {
      description:
        "OAuth2 client ID for logging in to this profile's platform. Pass an empty string to clear.",
    }),
    "console-url": arg(z.union([z.url(), z.literal("")]).optional(), {
      description: "Console base URL for this profile. Pass an empty string to clear.",
    }),
  }),
  run: async (args) => {
    const config = await readPlatformConfig();

    // Check if profile exists
    const profile = config.profiles[args.name];
    if (!profile) {
      throw new Error(`Profile "${args.name}" not found.`);
    }

    // Check if at least one property is provided
    if (
      !args.user &&
      !args["workspace-id"] &&
      args.permission === undefined &&
      args["machine-user"] === undefined &&
      args["machine-user-override"] === undefined &&
      args["platform-url"] === undefined &&
      args["oauth2-client-id"] === undefined &&
      args["console-url"] === undefined
    ) {
      throw new Error("Please provide at least one property to update.");
    }
    const oldUser = profile.user;
    const newUser = args.user || oldUser;
    const oldWorkspaceId = profile.workspace_id;
    const newWorkspaceId = args["workspace-id"] || oldWorkspaceId;
    let resolvedUser = newUser;

    // Compute the final machine_user and machine_user_override to validate the combination.
    const finalMachineUser =
      args["machine-user"] === "" ? undefined : (args["machine-user"] ?? profile.machine_user);
    const finalOverride =
      args["machine-user-override"] === "allow"
        ? undefined
        : (args["machine-user-override"] ?? profile.machine_user_override);
    const finalPlatformUrl =
      args["platform-url"] === "" ? undefined : (args["platform-url"] ?? profile.platform_url);
    const finalOAuth2ClientId =
      args["oauth2-client-id"] === ""
        ? undefined
        : (args["oauth2-client-id"] ?? profile.oauth2_client_id);
    const finalConsoleUrl =
      args["console-url"] === "" ? undefined : (args["console-url"] ?? profile.console_url);
    const finalPlatformConfigInput = {
      ...(finalPlatformUrl ? { platformUrl: finalPlatformUrl } : {}),
      ...(finalOAuth2ClientId ? { oauth2ClientId: finalOAuth2ClientId } : {}),
      ...(finalConsoleUrl ? { consoleUrl: finalConsoleUrl } : {}),
    };
    const finalPlatformConfig =
      Object.keys(finalPlatformConfigInput).length > 0 ? finalPlatformConfigInput : undefined;
    const tokenLookupPlatformConfig =
      args["platform-url"] === "" ? platformConfigFromProfile(profile) : finalPlatformConfig;

    if (
      (args["machine-user"] !== undefined || args["machine-user-override"] !== undefined) &&
      finalOverride === "deny" &&
      !finalMachineUser
    ) {
      if (args["machine-user-override"] === "deny") {
        throw new Error("--machine-user-override deny requires --machine-user.");
      }
      throw new Error(
        `Cannot clear the machine user while machine-user-override is "deny". Also pass --machine-user-override allow.`,
      );
    }

    // Skip remote validation when neither user nor workspace is changing.
    // This keeps `profile update <name> --permission write|read` working
    // offline and when the saved token is expired or the workspace has been
    // removed, important so a user can always lift their own readonly flag.
    if (
      args.user !== undefined ||
      args["workspace-id"] !== undefined ||
      args["platform-url"] !== undefined
    ) {
      // Check if user exists
      const { accessToken: token, user: latestUser } = await fetchLatestToken(
        config,
        newUser,
        tokenLookupPlatformConfig,
      );
      resolvedUser = latestUser;

      // Check if workspace exists
      const client = await initOperatorClient(token, finalPlatformConfig);
      const workspaces = await fetchAll(async (pageToken, maxPageSize) => {
        const { workspaces, nextPageToken } = await client.listWorkspaces({
          pageToken,
          pageSize: maxPageSize,
        });
        return [workspaces, nextPageToken];
      });
      const workspace = workspaces.find((ws) => ws.id === newWorkspaceId);
      if (!workspace) {
        throw new Error(`Workspace "${newWorkspaceId}" not found.`);
      }
    }

    // Update properties
    profile.user = resolvedUser;
    profile.workspace_id = newWorkspaceId;
    if (args.permission === "read") {
      profile.readonly = true;
    } else if (args.permission === "write") {
      delete profile.readonly;
    }
    if (args["machine-user"] !== undefined) {
      if (args["machine-user"] === "") {
        delete profile.machine_user;
      } else {
        profile.machine_user = args["machine-user"];
      }
    }
    if (args["machine-user-override"] === "deny") {
      profile.machine_user_override = "deny";
    } else if (args["machine-user-override"] === "allow") {
      delete profile.machine_user_override;
    }
    if (args["platform-url"] !== undefined) {
      if (args["platform-url"] === "") {
        delete profile.platform_url;
      } else {
        profile.platform_url = args["platform-url"];
      }
    }
    if (args["oauth2-client-id"] !== undefined) {
      if (args["oauth2-client-id"] === "") {
        delete profile.oauth2_client_id;
      } else {
        profile.oauth2_client_id = args["oauth2-client-id"];
      }
    }
    if (args["console-url"] !== undefined) {
      if (args["console-url"] === "") {
        delete profile.console_url;
      } else {
        profile.console_url = args["console-url"];
      }
    }
    writePlatformConfig(config);
    if (!args.json) {
      logger.success(`Profile "${args.name}" updated successfully`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: resolvedUser,
      workspaceId: newWorkspaceId,
      permission: profile.readonly === true ? "read" : "write",
      ...(profile.machine_user
        ? {
            machineUser: profile.machine_user,
            machineUserOverride: profile.machine_user_override ?? "allow",
          }
        : {}),
      ...(profile.platform_url ? { platformUrl: profile.platform_url } : {}),
      ...(profile.oauth2_client_id ? { oauth2ClientId: profile.oauth2_client_id } : {}),
      ...(profile.console_url ? { consoleUrl: profile.console_url } : {}),
    };
    logger.out(profileInfo);
  },
});

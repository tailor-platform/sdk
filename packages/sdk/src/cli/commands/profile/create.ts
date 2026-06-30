import { arg } from "politty";
import { z } from "zod";
import { fetchAll, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import type { ProfileInfo } from "./types";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new profile.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Profile name",
      }),
      user: arg(z.string(), {
        alias: "u",
        description: "User email",
      }),
      "workspace-id": arg(z.string(), {
        alias: "w",
        description: "Workspace ID",
      }),
      permission: arg(z.enum(["write", "read"]).default("write"), {
        description:
          "Profile permission. 'read' blocks all write commands while the profile is active.",
      }),
      "machine-user": arg(z.string().optional(), {
        alias: "m",
        description:
          "Default machine user name for application-data commands (query, workflow start, function test-run, machineuser token).",
      }),
      "machine-user-override": arg(z.enum(["allow", "deny"]).optional(), {
        description:
          "Whether the command line or TAILOR_PLATFORM_MACHINE_USER_NAME may override the profile's machine user. 'deny' requires --machine-user.",
      }),
      "platform-url": arg(z.url().optional(), {
        description: "Platform API base URL for this profile.",
        env: "TAILOR_PLATFORM_URL",
      }),
      "oauth2-client-id": arg(z.string().optional(), {
        description: "OAuth2 client ID for logging in to this profile's platform.",
        env: "TAILOR_PLATFORM_OAUTH2_CLIENT_ID",
      }),
      "console-url": arg(z.url().optional(), {
        description: "Console base URL for this profile.",
        env: "TAILOR_PLATFORM_CONSOLE_URL",
      }),
    })
    .strict(),
  run: async (args) => {
    if (args["machine-user-override"] === "deny" && !args["machine-user"]) {
      throw new Error("--machine-user-override deny requires --machine-user.");
    }

    const config = await readPlatformConfig();

    // Check if profile already exists
    if (config.profiles[args.name]) {
      throw new Error(`Profile "${args.name}" already exists.`);
    }

    // Check if user exists
    const platformConfigInput = {
      ...(args["platform-url"] ? { platformUrl: args["platform-url"] } : {}),
      ...(args["oauth2-client-id"] ? { oauth2ClientId: args["oauth2-client-id"] } : {}),
      ...(args["console-url"] ? { consoleUrl: args["console-url"] } : {}),
    };
    const platformConfig =
      Object.keys(platformConfigInput).length > 0 ? platformConfigInput : undefined;
    const token = await fetchLatestToken(config, args.user, platformConfig);

    // Check if workspace exists
    const client = await initOperatorClient(token, platformConfig);
    const workspaces = await fetchAll(async (pageToken, maxPageSize) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
        pageSize: maxPageSize,
      });
      return [workspaces, nextPageToken];
    });

    const workspace = workspaces.find((ws) => ws.id === args["workspace-id"]);
    if (!workspace) {
      throw new Error(`Workspace "${args["workspace-id"]}" not found.`);
    }

    // Create new profile
    config.profiles[args.name] = {
      user: args.user,
      workspace_id: args["workspace-id"],
      ...(args.permission === "read" ? { readonly: true } : {}),
      ...(args["machine-user"] ? { machine_user: args["machine-user"] } : {}),
      ...(args["machine-user-override"] === "deny"
        ? { machine_user_override: "deny" as const }
        : {}),
      ...(args["platform-url"] ? { platform_url: args["platform-url"] } : {}),
      ...(args["oauth2-client-id"] ? { oauth2_client_id: args["oauth2-client-id"] } : {}),
      ...(args["console-url"] ? { console_url: args["console-url"] } : {}),
    };
    writePlatformConfig(config);

    if (!args.json) {
      logger.success(`Profile "${args.name}" created successfully.`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: args.user,
      workspaceId: args["workspace-id"],
      permission: args.permission,
      ...(args["machine-user"]
        ? {
            machineUser: args["machine-user"],
            machineUserOverride: args["machine-user-override"] ?? "allow",
          }
        : {}),
      ...(args["platform-url"] ? { platformUrl: args["platform-url"] } : {}),
      ...(args["oauth2-client-id"] ? { oauth2ClientId: args["oauth2-client-id"] } : {}),
      ...(args["console-url"] ? { consoleUrl: args["console-url"] } : {}),
    };
    logger.out(profileInfo);
  },
});

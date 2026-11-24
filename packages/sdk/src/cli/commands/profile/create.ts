import { arg } from "@politty/zod";
import { z } from "zod";
import { fetchAll, initOperatorClient, platformConfigFromEnv } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  fetchLatestToken,
  readPlatformConfig,
  withPlatformConfigLock,
  writePlatformConfig,
} from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import type { ProfileInfo } from "./types";

function assertProfileAvailable(
  config: Awaited<ReturnType<typeof readPlatformConfig>>,
  name: string,
) {
  if (config.profiles[name]) {
    throw CLIError({ code: "PROFILE_EXISTS", message: `Profile "${name}" already exists.` });
  }
}

export interface CreateProfileOptions {
  name: string;
  user: string;
  workspaceId: string;
  permission?: "write" | "read";
  machineUser?: string;
  machineUserOverride?: "allow" | "deny";
  platformUrl?: string;
  oauth2ClientId?: string;
  consoleUrl?: string;
}

function assertOptionsValid(options: CreateProfileOptions) {
  const invalid = [
    ...(options.permission !== undefined && !["write", "read"].includes(options.permission)
      ? [`permission "${options.permission}" is not "write" or "read"`]
      : []),
    ...(options.platformUrl && !URL.canParse(options.platformUrl)
      ? [`platform URL "${options.platformUrl}" is not a URL`]
      : []),
    ...(options.consoleUrl && !URL.canParse(options.consoleUrl)
      ? [`console URL "${options.consoleUrl}" is not a URL`]
      : []),
  ];
  if (invalid.length > 0) {
    throw CLIError({
      code: "PROFILE_OPTIONS_INVALID",
      message: invalid.join("\n"),
      command: "profile create",
    });
  }
}

/**
 * Create a profile after checking that the user can sign in and sees the workspace. A platform
 * setting the options leave out is taken from `TAILOR_PLATFORM_URL` and its siblings unless it is
 * the default platform's, so the profile keeps the platform it was checked against.
 * @param input - Profile to create
 * @returns The created profile
 */
export async function createProfile(input: CreateProfileOptions): Promise<ProfileInfo> {
  const fromEnv = platformConfigFromEnv();
  const options: CreateProfileOptions = {
    ...input,
    ...(input.platformUrl === undefined && fromEnv?.platformUrl
      ? { platformUrl: fromEnv.platformUrl }
      : {}),
    ...(input.oauth2ClientId === undefined && fromEnv?.oauth2ClientId
      ? { oauth2ClientId: fromEnv.oauth2ClientId }
      : {}),
    ...(input.consoleUrl === undefined && fromEnv?.consoleUrl
      ? { consoleUrl: fromEnv.consoleUrl }
      : {}),
  };
  assertOptionsValid(options);
  const permission = options.permission ?? "write";
  if (options.machineUserOverride === "deny" && !options.machineUser) {
    throw CLIError({
      code: "PROFILE_OPTIONS_INVALID",
      message: "--machine-user-override deny requires --machine-user.",
      command: "profile create",
    });
  }

  const config = await readPlatformConfig();
  assertProfileAvailable(config, options.name);

  const platformConfigInput = {
    ...(options.platformUrl ? { platformUrl: options.platformUrl } : {}),
    ...(options.oauth2ClientId ? { oauth2ClientId: options.oauth2ClientId } : {}),
    ...(options.consoleUrl ? { consoleUrl: options.consoleUrl } : {}),
  };
  const platformConfig =
    Object.keys(platformConfigInput).length > 0 ? platformConfigInput : undefined;
  const { accessToken: token, user: resolvedUser } = await fetchLatestToken(
    config,
    options.user,
    platformConfig,
  );
  assertProfileAvailable(config, options.name);

  const client = await initOperatorClient(token, platformConfig);
  const workspaces = await fetchAll(async (pageToken, maxPageSize) => {
    const { workspaces, nextPageToken } = await client.listWorkspaces({
      pageToken,
      pageSize: maxPageSize,
    });
    return [workspaces, nextPageToken];
  });

  const workspace = workspaces.find((ws) => ws.id === options.workspaceId);
  if (!workspace) {
    throw CLIError({
      code: "WORKSPACE_NOT_FOUND",
      message: `Workspace "${options.workspaceId}" not found.`,
    });
  }

  await withPlatformConfigLock(async () => {
    const latest = await readPlatformConfig();
    assertProfileAvailable(latest, options.name);
    latest.profiles[options.name] = {
      user: resolvedUser,
      workspace_id: options.workspaceId,
      ...(permission === "read" ? { readonly: true } : {}),
      ...(options.machineUser ? { machine_user: options.machineUser } : {}),
      ...(options.machineUserOverride === "deny" ? { machine_user_override: "deny" as const } : {}),
      ...(options.platformUrl ? { platform_url: options.platformUrl } : {}),
      ...(options.oauth2ClientId ? { oauth2_client_id: options.oauth2ClientId } : {}),
      ...(options.consoleUrl ? { console_url: options.consoleUrl } : {}),
    };
    writePlatformConfig(latest);
  });

  return {
    name: options.name,
    user: resolvedUser,
    workspaceId: options.workspaceId,
    permission,
    ...(options.machineUser
      ? {
          machineUser: options.machineUser,
          machineUserOverride: options.machineUserOverride ?? "allow",
        }
      : {}),
    ...(options.platformUrl ? { platformUrl: options.platformUrl } : {}),
    ...(options.oauth2ClientId ? { oauth2ClientId: options.oauth2ClientId } : {}),
    ...(options.consoleUrl ? { consoleUrl: options.consoleUrl } : {}),
  };
}

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new profile.",
  args: z.strictObject({
    name: arg(z.string(), {
      positional: true,
      description: "Profile name",
    }),
    user: arg(z.string(), {
      alias: "u",
      description: "User email address or machine user client ID",
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
        "Default machine user name for application-data commands (query, workflow start, workflow run, function run, machineuser token), or `<auth>/<name>` to name its Auth service too.",
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
  }),
  run: async (args) => {
    const profileInfo = await createProfile({
      name: args.name,
      user: args.user,
      workspaceId: args["workspace-id"],
      permission: args.permission,
      machineUser: args["machine-user"],
      machineUserOverride: args["machine-user-override"],
      platformUrl: args["platform-url"],
      oauth2ClientId: args["oauth2-client-id"],
      consoleUrl: args["console-url"],
    });
    if (!args.json) {
      logger.success(`Profile "${args.name}" created successfully.`);
    }
    logger.out(profileInfo);
  },
});

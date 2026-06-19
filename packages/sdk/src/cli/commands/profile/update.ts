import { arg } from "politty";
import { z } from "zod";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { ProfileInfo } from "./types";

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update profile properties.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Profile name",
      }),
      user: arg(z.string().optional(), {
        alias: "u",
        description: "New user email",
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
    })
    .strict(),
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
      args["machine-user-override"] === undefined
    ) {
      throw new Error("Please provide at least one property to update.");
    }
    const oldUser = profile.user;
    const newUser = args.user || oldUser;
    const oldWorkspaceId = profile.workspace_id;
    const newWorkspaceId = args["workspace-id"] || oldWorkspaceId;

    // Compute the final machine_user and machine_user_override to validate the combination.
    const finalMachineUser =
      args["machine-user"] === "" ? undefined : (args["machine-user"] ?? profile.machine_user);
    const finalOverride =
      args["machine-user-override"] === "allow"
        ? undefined
        : (args["machine-user-override"] ?? profile.machine_user_override);

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
    if (args.user !== undefined || args["workspace-id"] !== undefined) {
      // Check if user exists
      const token = await fetchLatestToken(config, newUser);

      // Check if workspace exists
      const client = await initOperatorClient(token);
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
    profile.user = newUser;
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
    writePlatformConfig(config);
    if (!args.json) {
      logger.success(`Profile "${args.name}" updated successfully`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: newUser,
      workspaceId: newWorkspaceId,
      permission: profile.readonly === true ? "read" : "write",
      ...(profile.machine_user
        ? {
            machineUser: profile.machine_user,
            machineUserOverride: profile.machine_user_override ?? "allow",
          }
        : {}),
    };
    logger.out(profileInfo);
  },
});

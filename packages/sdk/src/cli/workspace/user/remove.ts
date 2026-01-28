import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, withCommonArgs, workspaceArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger } from "../../utils/logger";

const removeUserOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  email: z.string().email({ message: "email must be a valid email address" }),
});

export type RemoveUserOptions = z.input<typeof removeUserOptionsSchema>;

async function loadOptions(options: RemoveUserOptions) {
  const result = removeUserOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    email: result.data.email,
  };
}

/**
 * Remove a user from a workspace.
 * @param options - User remove options
 * @returns Promise that resolves when removal completes
 */
export async function removeUser(options: RemoveUserOptions): Promise<void> {
  const { client, workspaceId, email } = await loadOptions(options);

  await client.removeWorkspacePlatformUser({
    workspaceId,
    email,
  });
}

export const removeCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Remove a user from a workspace",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    email: {
      type: "string",
      description: "Email address of the user to remove",
      required: true,
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    if (!args.yes) {
      const confirmation = await logger.prompt(
        `Are you sure you want to remove user "${args.email}" from the workspace? (yes/no):`,
        {
          type: "text",
        },
      );
      if (confirmation !== "yes") {
        logger.info("User removal cancelled.");
        return;
      }
    }

    await removeUser({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      email: args.email,
    });

    logger.success(`User "${args.email}" removed from workspace.`);
  }),
});

import { arg } from "politty";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";

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

  const accessToken = await loadAccessToken({ useProfile: true, profile: result.data.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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

export const removeCommand = defineAppCommand({
  name: "remove",
  description: "Remove a user from a workspace",
  args: z
    .object({
      ...workspaceArgs,
      email: arg(z.email(), {
        description: "Email address of the user to remove",
      }),
      ...confirmationArgs,
    })
    .strict(),
  run: async (args) => {
    if (!args.yes) {
      const confirmation = await prompt.text({
        message: `Are you sure you want to remove user "${args.email}" from the workspace? (yes/no):`,
      });
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
  },
});

import { arg } from "@politty/valibot";
import * as v from "valibot";
import { confirmationArgs, workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";

// strip unknown keys
const removeUserOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  email: v.pipe(v.string(), v.email("email must be a valid email address")),
});

export type RemoveUserOptions = v.InferInput<typeof removeUserOptionsSchema>;

async function loadOptions(options: RemoveUserOptions) {
  const result = v.safeParse(removeUserOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  const accessToken = await loadAccessToken({ profile: result.output.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.output.workspaceId,
    profile: result.output.profile,
  });

  return {
    client,
    workspaceId,
    email: result.output.email,
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
  args: v.strictObject({
    ...workspaceArgs,
    email: arg(v.pipe(v.string(), v.email()), {
      description: "Email address of the user to remove",
    }),
    ...confirmationArgs,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
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

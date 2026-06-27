import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import { stringToRole, validRoles } from "./transform";

const inviteUserOptionsSchema = /* strip unknown keys */ z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  email: z.email({ message: "email must be a valid email address" }),
  role: z.enum(validRoles, { message: `role must be one of: ${validRoles.join(", ")}` }),
});

export type InviteUserOptions = z.input<typeof inviteUserOptionsSchema>;

async function loadOptions(options: InviteUserOptions) {
  const result = inviteUserOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.data.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    email: result.data.email,
    role: stringToRole(result.data.role),
  };
}

/**
 * Invite a user to a workspace.
 * @param options - User invite options
 * @returns Promise that resolves when invitation is sent
 */
export async function inviteUser(options: InviteUserOptions): Promise<void> {
  const { client, workspaceId, email, role } = await loadOptions(options);

  await client.inviteWorkspacePlatformUser({
    workspaceId,
    email,
    role,
  });
}

export const inviteCommand = defineAppCommand({
  name: "invite",
  description: "Invite a user to a workspace",
  args: z.strictObject({
    ...workspaceArgs,
    email: arg(z.email(), {
      description: "Email address of the user to invite",
    }),
    role: arg(z.enum(validRoles), {
      description: `Role to assign (${validRoles.join(", ")})`,
      alias: "r",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await inviteUser({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      email: args.email,
      role: args.role as (typeof validRoles)[number],
    });

    logger.success(`User "${args.email}" invited successfully with role "${args.role}".`);
  },
});

import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, withCommonArgs, workspaceArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger } from "../../utils/logger";
import { stringToRole, validRoles } from "./transform";

const inviteUserOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  email: z.string().email({ message: "email must be a valid email address" }),
  role: z.enum(validRoles, { message: `role must be one of: ${validRoles.join(", ")}` }),
});

export type InviteUserOptions = z.input<typeof inviteUserOptionsSchema>;

async function loadOptions(options: InviteUserOptions) {
  const result = inviteUserOptionsSchema.safeParse(options);
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

export const inviteCommand = defineCommand({
  meta: {
    name: "invite",
    description: "Invite a user to a workspace",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    email: {
      type: "string",
      description: "Email address of the user to invite",
      required: true,
    },
    role: {
      type: "string",
      description: `Role to assign (${validRoles.join(", ")})`,
      required: true,
      alias: "r",
    },
  },
  run: withCommonArgs(async (args) => {
    await inviteUser({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      email: args.email,
      role: args.role as (typeof validRoles)[number],
    });

    logger.success(`User "${args.email}" invited successfully with role "${args.role}".`);
  }),
});

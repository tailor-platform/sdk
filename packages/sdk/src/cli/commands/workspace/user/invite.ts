import { arg } from "@politty/valibot";
import * as v from "valibot";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import { stringToRole, validRoles } from "./transform";

// strip unknown keys
const inviteUserOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  email: v.pipe(v.string(), v.email("email must be a valid email address")),
  role: v.picklist(validRoles, `role must be one of: ${validRoles.join(", ")}`),
});

export type InviteUserOptions = v.InferInput<typeof inviteUserOptionsSchema>;

async function loadOptions(options: InviteUserOptions) {
  const result = v.safeParse(inviteUserOptionsSchema, options);
  if (!result.success) {
    throw new Error(assertDefined(result.issues[0], "Valibot returned no issues").message);
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
    role: stringToRole(result.output.role),
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
  args: v.strictObject({
    ...workspaceArgs,
    email: arg(v.pipe(v.string(), v.email()), {
      description: "Email address of the user to invite",
    }),
    role: arg(v.picklist(validRoles), {
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

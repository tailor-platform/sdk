import { arg } from "@politty/valibot";
import * as v from "valibot";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { stringToRole, validRoles } from "./transform";

// strip unknown keys
const updateUserOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  email: v.pipe(v.string(), v.email("email must be a valid email address")),
  role: v.picklist(validRoles, `role must be one of: ${validRoles.join(", ")}`),
});

export type UpdateUserOptions = v.InferInput<typeof updateUserOptionsSchema>;

async function loadOptions(options: UpdateUserOptions) {
  const result = v.safeParse(updateUserOptionsSchema, options);
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
    role: stringToRole(result.output.role),
  };
}

/**
 * Update a user's role in a workspace.
 * @param options - User update options
 * @returns Promise that resolves when update completes
 */
export async function updateUser(options: UpdateUserOptions): Promise<void> {
  const { client, workspaceId, email, role } = await loadOptions(options);

  await client.updateWorkspacePlatformUser({
    workspaceId,
    email,
    role,
  });
}

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update a user's role in a workspace",
  args: v.strictObject({
    ...workspaceArgs,
    email: arg(v.pipe(v.string(), v.email()), {
      description: "Email address of the user to update",
    }),
    role: arg(v.picklist(validRoles), {
      description: `New role to assign (${validRoles.join(", ")})`,
      alias: "r",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await updateUser({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      email: args.email,
      role: args.role as (typeof validRoles)[number],
    });

    logger.success(`User "${args.email}" updated to role "${args.role}".`);
  },
});

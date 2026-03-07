import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { stringToRole, validRoles } from "./transform";

const updateUserOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  email: z.string().email({ message: "email must be a valid email address" }),
  role: z.enum(validRoles, { message: `role must be one of: ${validRoles.join(", ")}` }),
});

export type UpdateUserOptions = z.input<typeof updateUserOptionsSchema>;

async function loadOptions(options: UpdateUserOptions) {
  const result = updateUserOptionsSchema.safeParse(options);
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

export const updateCommand = defineCommand({
  name: "update",
  description: "Update a user's role in a workspace",
  args: z
    .object({
      ...commonArgs,
      ...workspaceArgs,
      email: arg(z.email(), {
        description: "Email address of the user to update",
      }),
      role: arg(z.enum(validRoles), {
        description: `New role to assign (${validRoles.join(", ")})`,
        alias: "r",
      }),
    })
    .strict(),
  run: withCommonArgs(async (args) => {
    await updateUser({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      email: args.email,
      role: args.role as (typeof validRoles)[number],
    });

    logger.success(`User "${args.email}" updated to role "${args.role}".`);
  }),
});

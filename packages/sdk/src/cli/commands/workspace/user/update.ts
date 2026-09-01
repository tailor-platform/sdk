import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { stringToRole, validRoles } from "./transform";

// strip unknown keys
const updateUserOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  email: z.string().email({ message: "email must be a valid email address" }),
  role: z.enum(validRoles, { message: `role must be one of: ${validRoles.join(", ")}` }),
});

export type UpdateUserOptions = z.input<typeof updateUserOptionsSchema>;

async function loadOptions(options: UpdateUserOptions) {
  const validated = parseOptions(updateUserOptionsSchema, options);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  return {
    client,
    workspaceId,
    email: validated.email,
    role: stringToRole(validated.role),
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
  args: z.strictObject({
    ...workspaceArgs,
    email: arg(z.email(), {
      description: "Email address of the user to update",
    }),
    role: arg(z.enum(validRoles), {
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
      role: args.role,
    });

    logger.success(`User "${args.email}" updated to role "${args.role}".`);
  },
});

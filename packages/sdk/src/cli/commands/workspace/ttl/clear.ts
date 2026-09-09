import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { clearWorkspaceExpiry } from "../expiry";

// strip unknown keys
const clearTtlOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
});

export type ClearTtlOptions = z.input<typeof clearTtlOptionsSchema>;

/**
 * Drop a workspace's recorded prune expiry.
 *
 * A workspace recording no expiry is never deleted by `prune --expired`.
 * @param options - Clear options
 */
async function clearWorkspaceTtl(options: ClearTtlOptions): Promise<void> {
  const validated = parseOptions(clearTtlOptionsSchema, options);
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  await clearWorkspaceExpiry(client, workspaceId);
}

export const clearCommand = defineAppCommand({
  name: "clear",
  description: "Drop a workspace's recorded prune expiry.",
  notes: `
    A workspace recording no expiry is never deleted by \`workspace prune --expired\`. Clearing an expiry the workspace does not record succeeds without changing anything.
  `,
  args: z.strictObject({
    ...workspaceArgs,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await clearWorkspaceTtl({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.success("Workspace records no prune expiry.");
  },
});

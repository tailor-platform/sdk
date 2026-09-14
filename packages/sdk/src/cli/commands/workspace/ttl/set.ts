import { arg } from "@politty/zod";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { ageArg, parseAge } from "../age";
import { writeWorkspaceExpiry } from "../expiry";

// strip unknown keys
const setTtlOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  ttl: ageArg,
});

type SetTtlOptions = z.input<typeof setTtlOptionsSchema>;

/**
 * Record a workspace's prune expiry, replacing whatever it recorded before.
 *
 * The expiry runs from now rather than from the workspace's creation, so a
 * duration shorter than the workspace's age still leaves it a full window.
 * @param options - Expiry options
 * @returns The instant the workspace becomes prunable
 */
async function setWorkspaceTtl(options: SetTtlOptions): Promise<Date> {
  const validated = parseOptions(setTtlOptionsSchema, options);
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  const expiresAt = new Date(Date.now() + parseAge(validated.ttl));
  await writeWorkspaceExpiry(client, workspaceId, expiresAt);
  return expiresAt;
}

export const setCommand = defineAppCommand({
  name: "set",
  description: "Record when a workspace becomes prunable, replacing any expiry it already records.",
  notes: `
    The expiry runs from now, not from when the workspace was created, so \`--ttl 24h\` always leaves a full day regardless of the workspace's age. Use this to give a restored workspace a new expiry, or to record one after \`workspace create --ttl\` failed to.

    This is not an auto-delete timer: it only makes the workspace eligible for \`workspace prune --expired\`, which still honors delete protection and its own filters.
  `,
  args: z.strictObject({
    ...workspaceArgs,
    ttl: arg(ageArg, {
      description: "Time from now until the workspace becomes prunable, such as 30m, 24h, or 7d",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const expiresAt = await setWorkspaceTtl({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      ttl: args.ttl,
    });

    logger.success(`Workspace becomes prunable at ${expiresAt.toISOString()}.`);
  },
});

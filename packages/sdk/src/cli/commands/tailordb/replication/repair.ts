import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { confirmationArgs, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { replicationNotFoundError } from "./status";

export const repairCommand = defineAppCommand({
  name: "repair",
  description: "Rewrite tables of a TailorDB replication from their records.",
  notes:
    "Without `--type`, rewrites the tables in `ERROR`, such as a table deleted or replaced in BigQuery. With `--type`, rewrites those types' tables in any state but `PENDING` or `BACKFILLING`, and asks for confirmation first, since each table is copied again in full. The tables go to `PENDING`, and are rewritten shortly after; follow them with `tailor tailordb replication status`. The replication must be enabled, and its destination must have access to its dataset.",
  args: z.strictObject({
    ...workspaceArgs,
    ...confirmationArgs,
    name: arg(z.string(), {
      positional: true,
      description: "Replication name",
    }),
    type: arg(z.string().array().default([]), {
      alias: "t",
      description: "Type whose table to rewrite; repeat for several",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });
    const typeNames = [...new Set(args.type)];

    if (typeNames.length > 0 && !args.yes) {
      const confirmed = await prompt.confirm({
        message: `This will copy the tables of ${typeNames.join(", ")} in replication "${args.name}" again in full. Continue?`,
        default: false,
      });
      if (!confirmed) {
        throw CLIError({
          code: "TAILORDB_REPLICATION_REPAIR_CANCELLED",
          message: "Repair cancelled.",
        });
      }
    }

    let repaired: string[];
    try {
      ({ typeNames: repaired } = await client.repairTailorDBReplication({
        workspaceId,
        name: args.name,
        typeNames,
      }));
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw replicationNotFoundError(args.name, error);
      }
      throw error;
    }

    if (repaired.length === 0) {
      logger.info(
        `No table of replication "${args.name}" was queued by this call. Check \`tailor tailordb replication status ${args.name}\`.`,
      );
    } else {
      logger.success(
        `Tables of ${repaired.join(", ")} in replication "${args.name}" are waiting to be rewritten.`,
      );
    }
    printMutationResult({
      changed: repaired.length > 0,
      workspaceId,
      name: args.name,
      typeNames: repaired,
    });
  },
});

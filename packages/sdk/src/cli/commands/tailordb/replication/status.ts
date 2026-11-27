import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { TailorDBReplicationTableStatus_State as TableState } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { protoEnumName } from "#/cli/shared/proto-enum";

/**
 * Raise the error for a replication the workspace does not have.
 * @param name - Replication name
 * @param cause - Error the Platform returned
 * @returns CLIError coded `TAILORDB_REPLICATION_NOT_FOUND`
 */
export function replicationNotFoundError(name: string, cause: unknown) {
  return CLIError({
    code: "TAILORDB_REPLICATION_NOT_FOUND",
    message: `TailorDB replication "${name}" not found.`,
    cause,
  });
}

export const statusCommand = defineAppCommand({
  name: "status",
  description: "Show the state of each table a TailorDB replication writes.",
  notes:
    "A table is `PENDING` while it waits for its records to be copied, `BACKFILLING` while they are, `STREAMING` once changes are written as they happen, and `ERROR` when writing it failed, for example because the table was deleted in BigQuery. Run `tailor tailordb replication repair` to rewrite tables in `ERROR`.",
  args: z.strictObject({
    ...workspaceArgs,
    name: arg(z.string(), {
      positional: true,
      description: "Replication name",
    }),
  }),
  run: async (args) => {
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    let tables;
    try {
      ({ tables } = await client.getTailorDBReplicationStatus({ workspaceId, name: args.name }));
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw replicationNotFoundError(args.name, error);
      }
      throw error;
    }

    logger.out(
      tables.map((table) => ({
        type: table.type,
        table: table.table,
        state: protoEnumName(TableState, table.state) ?? String(table.state),
        backfillCompletedAt: table.backfillCompletedAt
          ? timestampDate(table.backfillCompletedAt).toISOString()
          : null,
        message: table.message,
      })),
    );
  },
});

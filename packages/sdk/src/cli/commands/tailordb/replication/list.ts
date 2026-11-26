import { z } from "zod";
import { paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { fetchWithinLimit, reportTruncation } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { omitUndefined } from "#/utils/omit-undefined";
import type { TailorDBReplication } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

function replicationInfo(replication: TailorDBReplication) {
  return {
    name: replication.name,
    namespace: replication.source?.namespace ?? "",
    destination: replication.destination,
    tablePrefix: replication.tablePrefix ?? "",
    enabled: replication.enabled,
    types: replication.source?.types.length ?? 0,
  };
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List the TailorDB replications in the workspace.",
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });
    const pageDirection = toPageDirection(args.order);
    const listed = await fetchWithinLimit(args.limit, (limit) =>
      fetchPaged(
        async (pageToken, pageSize) => {
          const { replications, nextPageToken } = await client.listTailorDBReplications(
            omitUndefined({ workspaceId, pageToken, pageSize, pageDirection }),
          );
          return [replications, nextPageToken];
        },
        { limit },
      ),
    );

    logger.out(listed.items.map(replicationInfo));
    await reportTruncation(listed, args.limit);
  },
});

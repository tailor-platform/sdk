import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type TailorDBReplicationDestination,
  TailorDBReplicationDestination_State as DestinationState,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { z } from "zod";
import { paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { fetchWithinLimit, reportTruncation } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { protoEnumName } from "#/cli/shared/proto-enum";
import { omitUndefined } from "#/utils/omit-undefined";

function destinationInfo(destination: TailorDBReplicationDestination) {
  const bigquery = destination.kind.case === "bigquery" ? destination.kind.value : undefined;
  const state = destination.status?.state ?? DestinationState.UNSPECIFIED;
  return {
    name: destination.name,
    dataset: bigquery ? `${bigquery.project}.${bigquery.dataset}` : "",
    serviceAccount: bigquery?.serviceAccountEmail ?? "",
    state: protoEnumName(DestinationState, state) ?? String(state),
    message: destination.status?.message ?? "",
    lastVerifiedAt: destination.status?.lastVerifiedAt
      ? timestampDate(destination.status.lastVerifiedAt).toISOString()
      : null,
  };
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List the TailorDB replication destinations in the workspace.",
  notes:
    "A destination is `PENDING_PERMISSION` until its service account is granted the BigQuery Data Editor role on the dataset and the BigQuery Job User role on its project, and `ACTIVE` once `tailor deploy` finds the grant.",
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
          const { destinations, nextPageToken } = await client.listTailorDBReplicationDestinations(
            omitUndefined({ workspaceId, pageToken, pageSize, pageDirection }),
          );
          return [destinations, nextPageToken];
        },
        { limit },
      ),
    );

    logger.out(listed.items.map(destinationInfo));
    await reportTruncation(listed, args.limit);
  },
});

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import type { AuthConnection } from "@tailor-platform/tailor-proto/auth_resource_pb";

interface ConnectionInfo {
  name: string;
  type: string;
  providerUrl: string;
  issuerUrl: string;
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  createdAt: Date | null;
}

function connectionInfo(connection: AuthConnection): ConnectionInfo {
  const oauth2 = connection.config.case === "oauth2" ? connection.config.value : undefined;
  return {
    name: connection.name,
    type: connection.config.case ?? "unknown",
    providerUrl: oauth2?.providerUrl ?? "",
    issuerUrl: oauth2?.issuerUrl ?? "",
    clientId: oauth2?.clientId ?? "",
    authUrl: oauth2?.authUrl ?? "",
    tokenUrl: oauth2?.tokenUrl ?? "",
    createdAt: connection.createdAt ? timestampDate(connection.createdAt) : null,
  };
}

export const listAuthConnectionCommand = defineAppCommand({
  name: "list",
  description: "List all auth connections.",
  args: z.strictObject({ ...workspaceArgs, ...paginationArgs() }),
  run: async (args) => {
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    try {
      const pageDirection = toPageDirection(args.order);
      const connections = await fetchPaged(
        async (pageToken, pageSize) => {
          const { connections, nextPageToken } = await client.listAuthConnections({
            workspaceId,
            pageToken,
            pageSize,
            pageDirection,
          });
          return [connections, nextPageToken];
        },
        { limit: args.limit },
      );
      logger.out(connections.map(connectionInfo));
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        logger.out([]);
        return;
      }
      throw error;
    }
  },
});

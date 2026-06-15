import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { paginationArgs, toPageDirection, workspaceArgs } from "@/cli/shared/args";
import { fetchPaged, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { AuthConnection } from "@tailor-proto/tailor/v1/auth_resource_pb";

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
  args: z.object({ ...workspaceArgs, ...paginationArgs() }).strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken({
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
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

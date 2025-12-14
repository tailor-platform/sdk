import { Code, ConnectError } from "@connectrpc/connect";
import { fetchAll, type OperatorClient } from "@/cli/client";

export function fetchTypes(
  client: OperatorClient,
  workspaceId: string,
  namespaceName: string,
) {
  return fetchAll(async (pageToken) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName,
        pageToken,
      });
      return [tailordbTypes, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
}

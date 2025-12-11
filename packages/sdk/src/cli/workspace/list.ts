import { defineCommand } from "citty";
import {
  commonArgs,
  humanizeRelativeTime,
  jsonArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { workspaceInfo, type WorkspaceInfo } from "./transform";

export async function workspaceList(): Promise<WorkspaceInfo[]> {
  // Load and validate options
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  // Fetch all workspaces
  const workspaces = await fetchAll(async (pageToken) => {
    const { workspaces, nextPageToken } = await client.listWorkspaces({
      pageToken,
    });
    return [workspaces, nextPageToken];
  });

  return workspaces.map(workspaceInfo);
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all Tailor Platform workspaces",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
  },
  run: withCommonArgs(async (args) => {
    // Validate CLI specific args
    const format = parseFormat(args.json);

    // Execute workspace list logic
    const workspaces = await workspaceList();

    // Transform only for table output; keep raw data for JSON
    const tableWorkspaces = workspaces.map(
      ({ updatedAt: _, createdAt, ...rest }) => ({
        ...rest,
        createdAt: humanizeRelativeTime(createdAt),
      }),
    );

    // Show workspaces info
    printWithFormat(format === "table" ? tableWorkspaces : workspaces, format);
  }),
});

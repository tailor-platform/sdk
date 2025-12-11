import { defineCommand } from "citty";
import {
  commonArgs,
  formatArgs,
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
    ...formatArgs,
  },
  run: withCommonArgs(async (args) => {
    // Validate CLI specific args
    const format = parseFormat(args.format);

    // Execute workspace list logic
    const workspaces = await workspaceList();

    // Hide updatedAt field from table output
    const displayWorkspaces = workspaces.map(
      ({ updatedAt: _, ...rest }) => rest,
    );

    // Show workspaces info
    printWithFormat(displayWorkspaces, format);
  }),
});

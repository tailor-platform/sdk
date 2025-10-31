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
import { workspaceInfo } from "./transform";

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
    // Validate args
    const format = parseFormat(args.format);

    // Show workspaces info
    const accessToken = await loadAccessToken();
    const client = await initOperatorClient(accessToken);
    const workspaces = await fetchAll(async (pageToken) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
      });
      return [workspaces, nextPageToken];
    });
    const workspaceInfos = workspaces.map(workspaceInfo);
    printWithFormat(workspaceInfos, format);
  }),
});

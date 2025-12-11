import { defineCommand } from "citty";
import {
  commonArgs,
  humanizeRelativeTime,
  jsonArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { workspaceInfo, type WorkspaceInfo } from "./transform";

export interface WorkspaceListOptions {
  limit?: number;
}

export async function workspaceList(
  options?: WorkspaceListOptions,
): Promise<WorkspaceInfo[]> {
  const limit = options?.limit;
  const hasLimit = limit !== undefined;

  // Load and validate options
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const results: WorkspaceInfo[] = [];
  let pageToken = "";

  // Fetch workspaces with optional limit using pageSize
  // If limit is undefined, this behaves like an unbounded listing.
  // If limit is set, we request up to the remaining number on each page
  // and stop once we have collected enough or the server has no more pages.

  while (true) {
    if (hasLimit && results.length >= limit!) {
      break;
    }

    const remaining = hasLimit ? limit! - results.length : undefined;
    const pageSize =
      remaining !== undefined && remaining > 0 ? remaining : undefined;

    const { workspaces, nextPageToken } = await client.listWorkspaces({
      pageToken,
      ...(pageSize !== undefined ? { pageSize } : {}),
    });

    const mapped = workspaces.map(workspaceInfo);

    if (remaining !== undefined && mapped.length > remaining) {
      results.push(...mapped.slice(0, remaining));
    } else {
      results.push(...mapped);
    }

    if (!nextPageToken) {
      break;
    }
    pageToken = nextPageToken;
  }

  return results;
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all Tailor Platform workspaces",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    limit: {
      type: "string",
      description: "Maximum number of workspaces to list",
    },
  },
  run: withCommonArgs(async (args) => {
    // Validate CLI specific args
    const format = parseFormat(args.json);

    // Parse and validate limit
    let limit: number | undefined;
    if (args.limit != null) {
      const parsed = Number(args.limit);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `--limit must be a positive integer, got "${args.limit}".`,
        );
      }
      limit = parsed;
    }

    // Execute workspace list logic
    const workspaces = await workspaceList({ limit });

    const formattedWorkspaces =
      format === "table"
        ? workspaces.map(({ updatedAt: _, createdAt, ...rest }) => ({
            ...rest,
            createdAt: humanizeRelativeTime(createdAt),
          }))
        : workspaces;

    printWithFormat(formattedWorkspaces, format);
  }),
});

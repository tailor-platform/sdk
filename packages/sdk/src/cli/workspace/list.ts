import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { humanizeRelativeTime, printData } from "../format";
import { workspaceInfo, type WorkspaceInfo } from "./transform";

export interface ListWorkspacesOptions {
  limit?: number;
}

const limitSchema = z.coerce.number().int().positive().optional();

export async function listWorkspaces(
  options?: ListWorkspacesOptions,
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
    // Parse and validate limit
    let limit: number | undefined;
    try {
      limit = limitSchema.parse(args.limit);
    } catch {
      throw new Error(
        `--limit must be a positive integer, got '${args.limit}'`,
      );
    }

    // Execute workspace list logic
    const workspaces = await listWorkspaces({ limit });

    const formattedWorkspaces = args.json
      ? workspaces
      : workspaces.map(({ updatedAt: _, createdAt, ...rest }) => ({
          ...rest,
          createdAt: humanizeRelativeTime(createdAt),
        }));

    printData(formattedWorkspaces, args.json);
  }),
});

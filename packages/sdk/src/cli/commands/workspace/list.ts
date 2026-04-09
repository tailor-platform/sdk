import { arg } from "politty";
import { z } from "zod";
import { positiveIntArg } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { workspaceInfo, type WorkspaceInfo } from "./transform";

export interface ListWorkspacesOptions {
  limit?: number;
}

/**
 * List workspaces with an optional limit.
 * @param options - Workspace listing options
 * @returns List of workspaces
 */
export async function listWorkspaces(options?: ListWorkspacesOptions): Promise<WorkspaceInfo[]> {
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
    const pageSize = remaining !== undefined && remaining > 0 ? remaining : undefined;

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

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all Tailor Platform workspaces.",
  args: z
    .object({
      limit: arg(positiveIntArg.optional(), {
        alias: "l",
        description: "Maximum number of workspaces to list",
      }),
    })
    .strict(),
  run: async (args) => {
    const workspaces = await listWorkspaces({ limit: args.limit });
    logger.out(workspaces, { display: { updatedAt: null } });
  },
});

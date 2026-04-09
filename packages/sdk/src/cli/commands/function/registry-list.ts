import { PageDirection } from "@tailor-proto/tailor/v1/resource_pb";
import { arg } from "politty";
import { z } from "zod";
import { positiveIntArg, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { humanizeRelativeTime } from "@/cli/shared/format";
import { logger } from "@/cli/shared/logger";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./registry-transform";

const listRegistryOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type ListRegistryOptions = z.input<typeof listRegistryOptionsSchema>;

async function loadOptions(options: ListRegistryOptions) {
  const result = listRegistryOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken({ useProfile: true, profile: result.data.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    limit: result.data.limit,
  };
}

/**
 * List function registries in a workspace with an optional limit.
 * @param options - Function registry listing options
 * @returns List of function registries
 */
export async function listFunctionRegistries(
  options: ListRegistryOptions,
): Promise<FunctionRegistryInfo[]> {
  const { client, workspaceId, limit } = await loadOptions(options);
  const hasLimit = limit !== undefined;

  const results: FunctionRegistryInfo[] = [];
  let pageToken = "";

  while (true) {
    if (hasLimit && results.length >= limit!) {
      break;
    }

    const remaining = hasLimit ? limit! - results.length : undefined;
    const pageSize = remaining !== undefined && remaining > 0 ? remaining : undefined;

    const { functions, nextPageToken } = await client.listFunctionRegistries({
      workspaceId,
      pageToken,
      ...(pageSize !== undefined ? { pageSize } : {}),
      sortBy: "updated_at",
      pageDirection: PageDirection.DESC,
    });

    const mapped = functions.map(functionRegistryInfo);
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
  description: "List function registries in a workspace",
  args: z
    .object({
      ...workspaceArgs,
      limit: arg(positiveIntArg.optional(), {
        alias: "l",
        description: "Maximum number of functions to list",
      }),
    })
    .strict(),
  run: async (args) => {
    const functions = await listFunctionRegistries({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      limit: args.limit,
    });

    const formatted = args.json
      ? functions
      : functions.map(({ createdAt, updatedAt, ...rest }) => ({
          ...rest,
          createdAt: humanizeRelativeTime(createdAt),
          updatedAt: humanizeRelativeTime(updatedAt),
        }));

    logger.out(formatted);
  },
});

import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, positiveIntArg, withCommonArgs, workspaceArgs } from "../../../args";
import { initOperatorClient } from "../../../client";
import { loadAccessToken, loadWorkspaceId } from "../../../context";
import { humanizeRelativeTime } from "../../../utils/format";
import { logger } from "../../../utils/logger";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

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

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
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

// oxlint-disable-next-line jsdoc/check-tag-names
/** @lintignore */
export const listCommand = defineCommand({
  name: "list",
  description: "List function registries in a workspace",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    limit: arg(positiveIntArg.optional(), {
      alias: "l",
      description: "Maximum number of functions to list",
    }),
  }),
  run: withCommonArgs(async (args) => {
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
  }),
});

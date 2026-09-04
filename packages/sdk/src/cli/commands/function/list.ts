import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

// strip unknown keys
const listFunctionRegistriesOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
});

export type ListFunctionRegistriesOptions = z.input<typeof listFunctionRegistriesOptionsSchema>;

async function loadOptions(options: ListFunctionRegistriesOptions) {
  const validated = parseOptions(listFunctionRegistriesOptionsSchema, options);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  return {
    client,
    workspaceId,
    order: validated.order,
    limit: validated.limit,
  };
}

/**
 * List function registries in a workspace with optional pagination.
 * @param options - Function registry listing options
 * @returns List of function registries
 */
export async function listFunctionRegistries(
  options: ListFunctionRegistriesOptions,
): Promise<FunctionRegistryInfo[]> {
  const { client, workspaceId, order, limit } = await loadOptions(options);
  const pageDirection = toPageDirection(order);

  const registries = await fetchPaged(
    async (pageToken, pageSize) => {
      try {
        const { functions, nextPageToken } = await client.listFunctionRegistries({
          workspaceId,
          pageToken,
          pageSize,
          sortBy: "updated_at",
          pageDirection,
        });
        return [functions, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    },
    { limit },
  );

  return registries.map(functionRegistryInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List function registries in a workspace",
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const registries = await listFunctionRegistries({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    const formatted = jsonOutput
      ? registries
      : registries.map(({ createdAt, updatedAt, ...rest }) => ({
          ...rest,
          createdAt: humanizeRelativeTime(createdAt),
          updatedAt: humanizeRelativeTime(updatedAt),
        }));

    logger.out(formatted);
  },
});

import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

const listFunctionRegistriesOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
});

export type ListFunctionRegistriesOptions = z.input<typeof listFunctionRegistriesOptionsSchema>;

async function loadOptions(options: ListFunctionRegistriesOptions) {
  const result = listFunctionRegistriesOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.data.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    order: result.data.order as Order | undefined,
    limit: result.data.limit,
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

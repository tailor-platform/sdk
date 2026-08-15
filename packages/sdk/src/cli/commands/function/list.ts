import { Code, ConnectError } from "@connectrpc/connect";
import * as v from "valibot";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

// strip unknown keys
const listFunctionRegistriesOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  order: v.optional(v.picklist(["asc", "desc"])),
  limit: v.optional(v.pipe(v.unknown(), v.transform(Number), v.integer(), v.minValue(0))),
});

export type ListFunctionRegistriesOptions = v.InferInput<
  typeof listFunctionRegistriesOptionsSchema
>;

async function loadOptions(options: ListFunctionRegistriesOptions) {
  const result = v.safeParse(listFunctionRegistriesOptionsSchema, options);
  if (!result.success) {
    throw new Error(assertDefined(result.issues[0], "Valibot returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.output.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.output.workspaceId,
    profile: result.output.profile,
  });

  return {
    client,
    workspaceId,
    order: result.output.order as Order | undefined,
    limit: result.output.limit,
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
  args: v.strictObject({
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

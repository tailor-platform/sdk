import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/valibot";
import * as v from "valibot";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

// strip unknown keys
const getFunctionRegistryOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  name: v.pipe(v.string(), v.minLength(1, "name is required")),
});

export type GetFunctionRegistryOptions = v.InferInput<typeof getFunctionRegistryOptionsSchema>;

async function loadOptions(options: GetFunctionRegistryOptions) {
  const result = v.safeParse(getFunctionRegistryOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
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
    name: result.output.name,
  };
}

/**
 * Get a function registry by name.
 * @param options - Function registry get options
 * @returns Function registry info
 */
export async function getFunctionRegistry(
  options: GetFunctionRegistryOptions,
): Promise<FunctionRegistryInfo> {
  const { client, workspaceId, name } = await loadOptions(options);

  const notFoundErrorMessage = `Function registry "${name}" not found.`;
  try {
    const response = await client.getFunctionRegistry({
      workspaceId,
      name,
    });

    if (!response.function) {
      throw new Error(notFoundErrorMessage);
    }

    return functionRegistryInfo(response.function);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(notFoundErrorMessage, { cause: error });
    }
    throw error;
  }
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Get a function registry by name",
  args: v.strictObject({
    ...workspaceArgs,
    name: arg(v.string(), {
      description: "Function name",
      alias: "n",
    }),
  }),
  run: async (args) => {
    const fn = await getFunctionRegistry({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      name: args.name,
    });

    const formatted = args.json
      ? fn
      : {
          ...fn,
          createdAt: humanizeRelativeTime(fn.createdAt),
          updatedAt: humanizeRelativeTime(fn.updatedAt),
        };

    logger.out(formatted);
  },
});

import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

const getFunctionRegistryOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  name: z.string().min(1, { message: "name is required" }),
});

export type GetFunctionRegistryOptions = z.input<typeof getFunctionRegistryOptionsSchema>;

async function loadOptions(options: GetFunctionRegistryOptions) {
  const result = getFunctionRegistryOptionsSchema.safeParse(options);
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
    name: result.data.name,
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
  args: z.strictObject({
    ...workspaceArgs,
    name: arg(z.string(), {
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

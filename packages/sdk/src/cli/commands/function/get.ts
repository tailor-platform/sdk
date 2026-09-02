import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

// strip unknown keys
const getFunctionRegistryOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  name: z.string().min(1, { message: "name is required" }),
});

export type GetFunctionRegistryOptions = z.input<typeof getFunctionRegistryOptionsSchema>;

async function loadOptions(options: GetFunctionRegistryOptions) {
  const validated = parseOptions(getFunctionRegistryOptionsSchema, options);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  return {
    client,
    workspaceId,
    name: validated.name,
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

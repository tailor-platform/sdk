import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../../../args";
import { initOperatorClient } from "../../../client";
import { loadAccessToken, loadWorkspaceId } from "../../../context";
import { humanizeRelativeTime } from "../../../utils/format";
import { logger } from "../../../utils/logger";
import { functionRegistryInfo, type FunctionRegistryInfo } from "./transform";

const getRegistryOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  name: z.string().min(1, { message: "name is required" }),
});

export type GetRegistryOptions = z.input<typeof getRegistryOptionsSchema>;

async function loadOptions(options: GetRegistryOptions) {
  const result = getRegistryOptionsSchema.safeParse(options);
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
    name: result.data.name,
  };
}

/**
 * Get a function registry by name.
 * @param options - Function registry get options
 * @returns Function registry info
 */
export async function getFunctionRegistry(
  options: GetRegistryOptions,
): Promise<FunctionRegistryInfo> {
  const { client, workspaceId, name } = await loadOptions(options);

  const notFoundErrorMessage = `Function "${name}" not found.`;
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
      throw new Error(notFoundErrorMessage);
    }
    throw error;
  }
}

export const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Get a function registry by name",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    name: {
      type: "string",
      description: "Function name",
      required: true,
      alias: "n",
    },
  },
  run: withCommonArgs(async (args) => {
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
  }),
});

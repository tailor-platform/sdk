import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { humanizeRelativeTime } from "../utils/format";
import { logger } from "../utils/logger";
import { workspaceDetails, type WorkspaceDetails } from "./transform";

const getWorkspaceOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }),
});

export type GetWorkspaceOptions = z.input<typeof getWorkspaceOptionsSchema>;

async function loadOptions(options: GetWorkspaceOptions) {
  const result = getWorkspaceOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  return {
    client,
    workspaceId: result.data.workspaceId,
  };
}

/**
 * Get detailed information about a workspace.
 * @param options - Workspace get options
 * @returns Workspace details
 */
export async function getWorkspace(options: GetWorkspaceOptions): Promise<WorkspaceDetails> {
  const { client, workspaceId } = await loadOptions(options);

  const response = await client.getWorkspace({
    workspaceId,
  });

  if (!response.workspace) {
    throw new Error(`Workspace "${workspaceId}" not found.`);
  }

  return workspaceDetails(response.workspace);
}

export const getCommand = defineCommand({
  name: "get",
  description: "Show detailed information about a workspace",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    "workspace-id": arg(z.string(), {
      alias: "w",
      description: "Workspace ID",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const workspace = await getWorkspace({
      workspaceId: args["workspace-id"],
    });

    const formattedWorkspace = args.json
      ? workspace
      : {
          ...workspace,
          createdAt: humanizeRelativeTime(workspace.createdAt),
          updatedAt: humanizeRelativeTime(workspace.updatedAt),
        };

    logger.out(formattedWorkspace);
  }),
});

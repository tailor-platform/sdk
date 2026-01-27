import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { humanizeRelativeTime } from "../utils/format";
import { logger } from "../utils/logger";
import { workspaceDetails, type WorkspaceDetails } from "./transform";

const describeWorkspaceOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }),
});

export type DescribeWorkspaceOptions = z.input<typeof describeWorkspaceOptionsSchema>;

async function loadOptions(options: DescribeWorkspaceOptions) {
  const result = describeWorkspaceOptionsSchema.safeParse(options);
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
 * @param options - Workspace describe options
 * @returns Workspace details
 */
export async function describeWorkspace(
  options: DescribeWorkspaceOptions,
): Promise<WorkspaceDetails> {
  const { client, workspaceId } = await loadOptions(options);

  const response = await client.getWorkspace({
    workspaceId,
  });

  if (!response.workspace) {
    throw new Error(`Workspace "${workspaceId}" not found.`);
  }

  return workspaceDetails(response.workspace);
}

export const describeCommand = defineCommand({
  meta: {
    name: "describe",
    description: "Show detailed information about a workspace",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      required: true,
      alias: "w",
    },
  },
  run: withCommonArgs(async (args) => {
    const workspace = await describeWorkspace({
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

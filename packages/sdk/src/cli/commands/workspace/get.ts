import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import {
  workspaceDetailsWithFolderName,
  workspaceNameTransformer,
  type WorkspaceDetails,
} from "./transform";

// strip unknown keys
const getWorkspaceOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
});

export type GetWorkspaceOptions = z.input<typeof getWorkspaceOptionsSchema>;

async function loadOptions(options: GetWorkspaceOptions) {
  const validated = parseOptions(getWorkspaceOptionsSchema, options);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  return {
    client,
    workspaceId,
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

  return workspaceDetailsWithFolderName(client, response.workspace);
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Show detailed information about a workspace",
  args: z.strictObject({
    ...workspaceArgs,
  }),
  run: async (args) => {
    const workspace = await getWorkspace({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const formattedWorkspace = args.json
      ? workspace
      : {
          ...workspace,
          createdAt: humanizeRelativeTime(workspace.createdAt),
          updatedAt: humanizeRelativeTime(workspace.updatedAt),
        };

    logger.out(formattedWorkspace, {
      display: { name: workspaceNameTransformer, folderName: null },
    });
  },
});

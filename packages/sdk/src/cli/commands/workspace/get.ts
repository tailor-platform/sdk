import * as v from "valibot";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import {
  workspaceDetailsWithFolderName,
  workspaceNameTransformer,
  type WorkspaceDetails,
} from "./transform";

// strip unknown keys
const getWorkspaceOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
});

export type GetWorkspaceOptions = v.InferInput<typeof getWorkspaceOptionsSchema>;

async function loadOptions(options: GetWorkspaceOptions) {
  const result = v.safeParse(getWorkspaceOptionsSchema, options);
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
  args: v.strictObject({
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

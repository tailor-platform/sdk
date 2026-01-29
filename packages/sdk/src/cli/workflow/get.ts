import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { nameArgs } from "./args";
import { type WorkflowInfo, toWorkflowInfo } from "./transform";

export interface GetWorkflowOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
}

/**
 * Resolve a workflow definition by name.
 * @param client - Operator client
 * @param workspaceId - Workspace ID
 * @param name - Workflow name
 * @returns Resolved workflow
 */
export async function resolveWorkflow(
  client: Awaited<ReturnType<typeof initOperatorClient>>,
  workspaceId: string,
  name: string,
) {
  const { workflow } = await client.getWorkflowByName({
    workspaceId,
    workflowName: name,
  });
  if (!workflow) {
    throw new Error(`Workflow '${name}' not found.`);
  }
  return workflow;
}

/**
 * Get a workflow by name and return CLI-friendly info.
 * @param options - Workflow lookup options
 * @returns Workflow information
 */
export async function getWorkflow(options: GetWorkflowOptions): Promise<WorkflowInfo> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  try {
    const workflow = await resolveWorkflow(client, workspaceId, options.name);
    return toWorkflowInfo(workflow);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Workflow '${options.name}' not found.`);
    }
    throw error;
  }
}

export const getCommand = defineCommand({
  name: "get",
  description: "Get workflow details",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    ...nameArgs,
  }),
  run: withCommonArgs(async (args) => {
    const workflow = await getWorkflow({
      name: args.name,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.out(workflow);
  }),
});

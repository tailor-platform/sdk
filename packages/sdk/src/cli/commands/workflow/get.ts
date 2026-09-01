import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { type initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { nameArgs } from "./args";
import { type WorkflowInfo, toWorkflowInfo } from "./transform";

type WorkflowLike = {
  name: string;
};

export type GetWorkflowTypedOptions<W extends WorkflowLike = WorkflowLike> = {
  workflow: W;
  workspaceId?: string;
  profile?: string;
};

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
export async function getWorkflow<W extends WorkflowLike>(
  options: GetWorkflowTypedOptions<W>,
): Promise<WorkflowInfo> {
  const name = options.workflow.name;
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });

  try {
    const workflow = await resolveWorkflow(client, workspaceId, name);
    return toWorkflowInfo(workflow);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Workflow '${name}' not found.`, { cause: error });
    }
    throw error;
  }
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Get workflow details.",
  args: z.strictObject({
    ...workspaceArgs,
    ...nameArgs,
  }),
  run: async (args) => {
    const workflow = await getWorkflow({
      workflow: { name: args.name },
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.out(workflow);
  },
});

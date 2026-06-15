import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
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
 * @deprecated Use GetWorkflowTypedOptions instead.
 */
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
export async function getWorkflow<W extends WorkflowLike>(
  options: GetWorkflowTypedOptions<W>,
): Promise<WorkflowInfo>;
export async function getWorkflow(options: GetWorkflowOptions): Promise<WorkflowInfo>;
export async function getWorkflow<W extends WorkflowLike>(
  options: GetWorkflowOptions | GetWorkflowTypedOptions<W>,
): Promise<WorkflowInfo> {
  // Discriminant: legacy options have top-level 'name', typed options use 'workflow'.
  // Note: passing a workflow object directly (e.g., getWorkflow(myWorkflow)) would match
  // the legacy branch due to structural typing, but still works correctly since it reads .name.
  const name = "name" in options ? options.name : options.workflow.name;
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
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
  args: z
    .object({
      ...workspaceArgs,
      ...nameArgs,
    })
    .strict(),
  run: async (args) => {
    const workflow = await getWorkflow({
      name: args.name,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    logger.out(workflow);
  },
});

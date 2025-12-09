import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { type WorkflowInfo, toWorkflowInfo } from "./transform";

export interface WorkflowGetOptions {
  nameOrId: string;
  workspaceId?: string;
  profile?: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function workflowGet(
  options: WorkflowGetOptions,
): Promise<WorkflowInfo> {
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
    if (isUUID(options.nameOrId)) {
      const { workflow } = await client.getWorkflow({
        workspaceId,
        workflowId: options.nameOrId,
      });
      if (!workflow) {
        throw new Error(`Workflow '${options.nameOrId}' not found.`);
      }
      return toWorkflowInfo(workflow);
    }

    const { workflow } = await client.getWorkflowByName({
      workspaceId,
      workflowName: options.nameOrId,
    });
    if (!workflow) {
      throw new Error(`Workflow '${options.nameOrId}' not found.`);
    }
    return toWorkflowInfo(workflow);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Workflow '${options.nameOrId}' not found.`);
    }
    throw error;
  }
}

export const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Get workflow details",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
    nameOrId: {
      type: "positional",
      description: "Workflow name or ID",
      required: true,
    },
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
    },
  },
  run: withCommonArgs(async (args) => {
    const format = parseFormat(args.format);

    const workflow = await workflowGet({
      nameOrId: args.nameOrId,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    printWithFormat(workflow, format);
  }),
});

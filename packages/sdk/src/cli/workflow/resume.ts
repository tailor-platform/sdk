import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { parseFormat, printWithFormat } from "../format";
import { parseDuration, waitForExecution } from "./start";
import { type WorkflowExecutionInfo } from "./transform";

export interface WorkflowResumeOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
}

export interface WorkflowResumeResultWithWait {
  executionId: string;
  wait: () => Promise<WorkflowExecutionInfo>;
}

export async function workflowResume(
  options: WorkflowResumeOptions,
): Promise<WorkflowResumeResultWithWait> {
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
    const { executionId } = await client.testResumeWorkflow({
      workspaceId,
      executionId: options.executionId,
    });

    return {
      executionId,
      wait: () =>
        waitForExecution({
          client,
          workspaceId,
          executionId,
          interval: options.interval ?? 3000,
          format: "json",
        }),
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.NotFound) {
        throw new Error(`Execution '${options.executionId}' not found.`);
      }
      if (error.code === Code.FailedPrecondition) {
        throw new Error(
          `Execution '${options.executionId}' is not in a resumable state.`,
        );
      }
    }
    throw error;
  }
}

export const resumeCommand = defineCommand({
  meta: {
    name: "resume",
    description: "Resume a failed workflow execution",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    executionId: {
      type: "positional",
      description: "Failed execution ID",
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
    wait: {
      type: "boolean",
      description: "Wait for execution to complete after resuming",
      default: false,
    },
    interval: {
      type: "string",
      description: "Polling interval when using --wait",
      default: "3s",
    },
  },
  run: withCommonArgs(async (args) => {
    const format = parseFormat(args.json);
    const interval = parseDuration(args.interval);

    const { executionId, wait } = await workflowResume({
      executionId: args.executionId,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      interval,
    });

    if (format !== "json") {
      const { default: consola } = await import("consola");
      consola.info(`Execution ID: ${executionId}`);
    }

    if (args.wait) {
      const result = await wait();
      printWithFormat(result, format);
    } else {
      printWithFormat({ executionId }, format);
    }
  }),
});

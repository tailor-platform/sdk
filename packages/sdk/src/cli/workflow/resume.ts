import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../format";
import { logger } from "../utils/logger";
import { parseDuration, waitForExecution, type WaitOptions } from "./start";
import { type WorkflowExecutionInfo } from "./transform";

export interface ResumeWorkflowOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
}

export interface ResumeWorkflowResultWithWait {
  executionId: string;
  wait: (options?: WaitOptions) => Promise<WorkflowExecutionInfo>;
}

export async function resumeWorkflow(
  options: ResumeWorkflowOptions,
): Promise<ResumeWorkflowResultWithWait> {
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
      wait: (waitOptions?: WaitOptions) =>
        waitForExecution({
          client,
          workspaceId,
          executionId,
          interval: options.interval ?? 3000,
          showProgress: waitOptions?.showProgress,
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
    ...workspaceArgs,
    executionId: {
      type: "positional",
      description: "Failed execution ID",
      required: true,
    },
    wait: {
      type: "boolean",
      alias: "W",
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
    const interval = parseDuration(args.interval);

    const { executionId, wait } = await resumeWorkflow({
      executionId: args.executionId,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      interval,
    });

    if (!args.json) {
      logger.info(`Execution ID: ${executionId}`, { mode: "stream" });
    }

    if (args.wait) {
      const result = await wait({ showProgress: !args.json });
      printData(result, args.json);
    } else {
      printData({ executionId }, args.json);
    }
  }),
});

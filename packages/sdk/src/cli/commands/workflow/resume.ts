import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { parseDuration, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { waitArgs } from "./args";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import { waitForExecution, type WaitOptions } from "./start";
import { getWorkflowWaitFailureMessage, type WorkflowWaitResult } from "./waiter";

export interface ResumeWorkflowOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
}

export interface ResumeWorkflowResultWithWait {
  executionId: string;
  wait: (options?: WaitOptions) => Promise<WorkflowWaitResult>;
}

/**
 * Resume a suspended workflow execution and return a handle to wait for completion.
 * @param options - Resume options
 * @returns Resume result with wait helper
 */
export async function resumeWorkflow(
  options: ResumeWorkflowOptions,
): Promise<ResumeWorkflowResultWithWait> {
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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
          timeout: waitOptions?.timeout,
          until: waitOptions?.until,
          showProgress: waitOptions?.showProgress,
        }),
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.NotFound) {
        throw new Error(`Execution '${options.executionId}' not found.`, { cause: error });
      }
      if (error.code === Code.FailedPrecondition) {
        throw new Error(`Execution '${options.executionId}' is not in a resumable state.`, {
          cause: error,
        });
      }
    }
    throw error;
  }
}

export const resumeCommand = defineAppCommand({
  name: "resume",
  description: "Resume a failed or pending workflow execution.",
  args: z
    .object({
      ...workspaceArgs,
      "execution-id": arg(z.string(), {
        positional: true,
        description: "Failed execution ID",
      }),
      ...waitArgs,
    })
    .strict(),
  run: async (args) => {
    const jsonOutput = logger.jsonMode || args.json;
    const { executionId, wait } = await resumeWorkflow({
      executionId: args.executionId,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      interval: parseDuration(args.interval),
    });

    if (!jsonOutput) {
      logger.info(`Execution ID: ${executionId}`, { mode: "stream" });
    }

    if (args.wait) {
      const result = await wait({
        showProgress: !jsonOutput,
        timeout: parseDuration(args.timeout),
        until: args.until,
      });
      if (args.logs && !jsonOutput) {
        const { execution } = await getWorkflowExecution({
          executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          logs: true,
        });
        printExecutionWithLogs(execution);
      } else if (args.logs) {
        const { execution } = await getWorkflowExecution({
          executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          logs: true,
        });
        logger.out({ ...result, jobDetails: execution.jobDetails });
      } else {
        logger.out(result);
      }
      const failureMessage = getWorkflowWaitFailureMessage(result, args.until);
      if (failureMessage) {
        throw new Error(failureMessage);
      }
    } else {
      logger.out({ executionId });
    }
  },
});

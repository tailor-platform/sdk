import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { parseDuration, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { waitArgs } from "./args";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import { waitForExecution, type WaitOptions } from "./start";
import { getWorkflowWaitFailure, type WorkflowWaitResult } from "./waiter";

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
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });

  try {
    const { executionId } = await client.resumeWorkflowExecution({
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
        throw CLIError({
          code: "WORKFLOW_EXECUTION_NOT_FOUND",
          message: `Execution '${options.executionId}' not found.`,
          cause: error,
        });
      }
      if (error.code === Code.FailedPrecondition) {
        throw CLIError({
          code: "WORKFLOW_EXECUTION_NOT_RESUMABLE",
          message: `Execution '${options.executionId}' is not in a resumable state.`,
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
  args: z.strictObject({
    ...workspaceArgs,
    "execution-id": arg(z.string(), {
      positional: true,
      description: "Failed execution ID",
    }),
    ...waitArgs,
  }),
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
      const failure = getWorkflowWaitFailure(result, args.until);
      if (failure) {
        throw failure;
      }
    } else {
      logger.out({ executionId });
    }
  },
});

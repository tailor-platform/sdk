import { arg } from "politty";
import { z } from "zod";
import { parseDuration, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { workflowWaitControlArgs } from "./args";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import {
  getWorkflowWaitFailureMessage,
  waitForWorkflowExecutionById,
  type WaitWorkflowExecutionOptions,
  type WorkflowWaitResult,
} from "./waiter";

export interface WorkflowWaitOutput extends WorkflowWaitResult {
  jobDetails?: Awaited<ReturnType<typeof getWorkflowExecution>>["execution"]["jobDetails"];
}

/**
 * Wait for an existing workflow execution by ID.
 * @param options - Workflow wait options
 * @returns Workflow wait result
 */
export async function waitWorkflowExecution(
  options: WaitWorkflowExecutionOptions,
): Promise<WorkflowWaitResult> {
  return await waitForWorkflowExecutionById({
    ...options,
    showProgress: options.showProgress ?? !logger.jsonMode,
    trackJobs: options.trackJobs ?? true,
  });
}

/**
 * Attach workflow job logs to a wait result when requested.
 * @param result - Workflow wait result
 * @param options - Workflow wait options
 * @returns Workflow wait result with optional job details
 */
export async function addWorkflowLogsToWaitResult(
  result: WorkflowWaitResult,
  options: WaitWorkflowExecutionOptions,
): Promise<WorkflowWaitOutput> {
  const { execution } = await getWorkflowExecution({
    executionId: options.executionId,
    workspaceId: options.workspaceId,
    profile: options.profile,
    logs: true,
  });

  return {
    ...result,
    jobDetails: execution.jobDetails,
  };
}

export const waitCommand = defineAppCommand({
  name: "wait",
  description: "Wait for a workflow execution.",
  examples: [
    {
      cmd: "execution-id --until success --timeout 10m --json",
      desc: "Wait for workflow success",
    },
    {
      cmd: "execution-id --until suspended --timeout 6m --logs --json",
      desc: "Wait for a workflow wait point",
    },
    {
      cmd: "execution-id --until terminal",
      desc: "Wait for success, failure, or suspension",
    },
  ],
  args: z.strictObject({
    ...workspaceArgs,
    "execution-id": arg(z.string(), {
      positional: true,
      description: "Execution ID",
    }),
    ...workflowWaitControlArgs,
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode || args.json;
    const result = await waitWorkflowExecution({
      executionId: args.executionId,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      interval: parseDuration(args.interval),
      timeout: parseDuration(args.timeout),
      until: args.until,
      showProgress: !jsonOutput,
    });

    const output: WorkflowWaitOutput = args.logs
      ? await addWorkflowLogsToWaitResult(result, {
          executionId: args.executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
        })
      : result;

    if (!jsonOutput && output.jobDetails) {
      printExecutionWithLogs({
        id: output.id,
        workflowName: output.workflowName,
        status: output.status,
        jobExecutions: output.jobExecutions,
        startedAt: output.startedAt,
        finishedAt: output.finishedAt,
        jobDetails: output.jobDetails,
      });
    } else {
      logger.out(output);
    }

    const failureMessage = getWorkflowWaitFailureMessage(result, args.until);
    if (failureMessage) {
      throw new Error(failureMessage);
    }
  },
});

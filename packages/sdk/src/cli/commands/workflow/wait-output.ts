import { logger } from "#/cli/shared/logger";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import { getWorkflowWaitFailure, type WorkflowWaitResult } from "./waiter";
import type { WorkflowWaitUntil } from "./status";

interface WorkflowWaitOutputOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  logs: boolean;
  jsonOutput: boolean;
  until: WorkflowWaitUntil;
}

/**
 * Print a started or resumed execution's wait result, then report a failed wait.
 * @param result - Result of waiting for the execution
 * @param options - Execution lookup and output options
 */
export async function printWorkflowWaitResult(
  result: WorkflowWaitResult,
  options: WorkflowWaitOutputOptions,
): Promise<void> {
  if (options.logs) {
    const { execution } = await getWorkflowExecution({
      executionId: options.executionId,
      workspaceId: options.workspaceId,
      profile: options.profile,
      logs: true,
    });
    if (options.jsonOutput) {
      logger.out({ ...result, jobDetails: execution.jobDetails });
    } else {
      printExecutionWithLogs(execution);
    }
  } else {
    logger.out(result);
  }
  const failure = getWorkflowWaitFailure(result, options.until);
  if (failure) throw failure;
}

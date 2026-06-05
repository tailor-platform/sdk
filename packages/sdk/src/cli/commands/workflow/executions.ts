import { create } from "@bufbuild/protobuf";
import {
  Condition_Operator,
  ConditionSchema,
  FilterSchema,
} from "@tailor-proto/tailor/v1/resource_pb";
import { WorkflowExecution_Status } from "@tailor-proto/tailor/v1/workflow_resource_pb";
import { arg } from "politty";
import { z } from "zod";
import {
  type Order,
  pagedLogArgs,
  parseDuration,
  toPageDirection,
  workspaceArgs,
} from "@/cli/shared/args";
import { fetchPaged, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { formatKeyValueTable } from "@/cli/shared/format";
import { styles, logger } from "@/cli/shared/logger";
import { waitArgs } from "./args";
import { type WorkflowWaitUntil } from "./status";
import {
  type WorkflowExecutionInfo,
  type WorkflowJobExecutionInfo,
  toWorkflowExecutionInfo,
  toWorkflowJobExecutionInfo,
} from "./transform";
import {
  getWorkflowWaitFailureMessage,
  waitForWorkflowExecution,
  waitForWorkflowExecutionById,
  type WorkflowWaitResult,
} from "./waiter";
import type { FunctionExecution } from "@tailor-proto/tailor/v1/function_resource_pb";

type WorkflowLike = {
  name: string;
};

export type ListWorkflowExecutionsTypedOptions<W extends WorkflowLike = WorkflowLike> = {
  workflow?: W;
  status?: string;
  workspaceId?: string;
  profile?: string;
  order?: Order;
  limit?: number;
};

/**
 * @deprecated Use ListWorkflowExecutionsTypedOptions instead.
 */
export interface ListWorkflowExecutionsOptions {
  workspaceId?: string;
  profile?: string;
  workflowName?: string;
  status?: string;
  order?: Order;
  limit?: number;
}

export interface GetWorkflowExecutionOptions {
  executionId: string;
  workspaceId?: string;
  profile?: string;
  interval?: number;
  timeout?: number;
  until?: WorkflowWaitUntil;
  logs?: boolean;
}

export interface WorkflowExecutionDetailInfo extends WorkflowExecutionInfo {
  jobDetails?: (WorkflowJobExecutionInfo & {
    logs?: string;
    result?: string;
  })[];
}

export interface GetWorkflowExecutionResult {
  execution: WorkflowExecutionDetailInfo;
  wait: () => Promise<WorkflowExecutionDetailInfo>;
}

function parseStatus(status: string): WorkflowExecution_Status {
  const upperStatus = status.toUpperCase();
  switch (upperStatus) {
    case "PENDING":
      return WorkflowExecution_Status.PENDING;
    case "PENDING_RESUME":
      return WorkflowExecution_Status.PENDING_RESUME;
    case "RUNNING":
      return WorkflowExecution_Status.RUNNING;
    case "SUCCESS":
      return WorkflowExecution_Status.SUCCESS;
    case "FAILED":
      return WorkflowExecution_Status.FAILED;
    case "PENDING_RETRY":
      return WorkflowExecution_Status.PENDING_RETRY;
    case "WAITING":
      return WorkflowExecution_Status.WAITING;
    case "UNSPECIFIED":
      return WorkflowExecution_Status.UNSPECIFIED;
    default:
      throw new Error(
        `Invalid status: ${status}. Valid values: UNSPECIFIED, PENDING, PENDING_RESUME, RUNNING, SUCCESS, FAILED, PENDING_RETRY, WAITING`,
      );
  }
}

/**
 * List workflow executions with optional filters.
 *
 * Returns at most `options.limit` items. When `limit` is omitted or 0 the
 * function pages through every execution. The CLI caps this at 50 by
 * default via `pagedLogArgs`; programmatic callers that want the same
 * cap should pass `limit: 50` explicitly.
 * @param options - Workflow execution listing options
 * @returns List of workflow executions
 */
export async function listWorkflowExecutions<W extends WorkflowLike>(
  options?: ListWorkflowExecutionsTypedOptions<W>,
): Promise<WorkflowExecutionInfo[]>;
export async function listWorkflowExecutions(
  options?: ListWorkflowExecutionsOptions,
): Promise<WorkflowExecutionInfo[]>;
export async function listWorkflowExecutions<W extends WorkflowLike>(
  options?: ListWorkflowExecutionsOptions | ListWorkflowExecutionsTypedOptions<W>,
): Promise<WorkflowExecutionInfo[]> {
  // Discriminant: legacy options have 'workflowName', typed options use 'workflow'.
  // Note: since ListWorkflowExecutionsTypedOptions has all optional fields, TypeScript may
  // resolve a legacy-typed variable to the typed overload (skipping excess property checks).
  // Runtime behavior is correct regardless because the discriminant handles both shapes.
  const workflowName =
    options && "workflowName" in options
      ? options.workflowName
      : options && "workflow" in options
        ? options.workflow?.name
        : undefined;
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const filters: ReturnType<typeof create<typeof FilterSchema>>[] = [];

  if (options?.status) {
    const statusValue = parseStatus(options.status);
    filters.push(
      create(FilterSchema, {
        condition: create(ConditionSchema, {
          field: "status",
          operator: Condition_Operator.EQ,
          value: { kind: { case: "numberValue", value: statusValue } },
        }),
      }),
    );
  }

  const filter =
    filters.length > 0
      ? create(FilterSchema, {
          and: filters,
        })
      : undefined;

  const pageDirection = toPageDirection(options?.order ?? "desc");
  const executions = await fetchPaged(
    async (pageToken, pageSize) => {
      const { executions, nextPageToken } = await client.listWorkflowExecutions({
        workspaceId,
        workflowName: workflowName ?? "",
        pageToken,
        pageSize,
        pageDirection,
        filter,
      });
      return [executions, nextPageToken];
    },
    { limit: options?.limit },
  );

  return executions.map(toWorkflowExecutionInfo);
}

/**
 * Get a single workflow execution with optional logs.
 * @param options - Workflow execution lookup options
 * @returns Workflow execution with optional logs
 */
export async function getWorkflowExecution(
  options: GetWorkflowExecutionOptions,
): Promise<GetWorkflowExecutionResult> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  async function fetchFunctionExecution(
    functionExecutionId: string,
  ): Promise<FunctionExecution | undefined> {
    try {
      const filter = create(FilterSchema, {
        condition: create(ConditionSchema, {
          field: "id",
          operator: Condition_Operator.EQ,
          value: { kind: { case: "stringValue", value: functionExecutionId } },
        }),
      });

      const response = await client.listFunctionExecutions({
        workspaceId,
        filter,
        pageSize: 1,
      });

      return response.executions[0];
    } catch {
      return undefined;
    }
  }

  async function fetchExecutionWithLogs(
    executionId: string,
    includeLogs: boolean,
  ): Promise<WorkflowExecutionDetailInfo> {
    const { execution } = await client.getWorkflowExecution({
      workspaceId,
      executionId,
    });

    if (!execution) {
      throw new Error(`Execution '${executionId}' not found.`);
    }

    const result: WorkflowExecutionDetailInfo = toWorkflowExecutionInfo(execution);

    if (includeLogs && execution.jobExecutions.length > 0) {
      result.jobDetails = await Promise.all(
        execution.jobExecutions.map(async (job) => {
          const jobInfo = toWorkflowJobExecutionInfo(job);
          if (job.executionId) {
            const functionExecution = await fetchFunctionExecution(job.executionId);
            if (functionExecution) {
              return {
                ...jobInfo,
                logs: functionExecution.logs || undefined,
                result: functionExecution.result || undefined,
              };
            }
          }
          return jobInfo;
        }),
      );
    }

    return result;
  }

  async function waitForCompletion(): Promise<WorkflowExecutionDetailInfo> {
    const interval = options.interval ?? 3000;
    await waitForWorkflowExecution({
      client,
      workspaceId,
      executionId: options.executionId,
      interval,
      timeout: options.timeout,
      until: options.until ?? "terminal",
    });
    return await fetchExecutionWithLogs(options.executionId, options.logs ?? false);
  }

  const execution = await fetchExecutionWithLogs(options.executionId, options.logs ?? false);

  return {
    execution,
    wait: waitForCompletion,
  };
}

/**
 * Print a workflow execution and its logs in a human-readable format.
 * @param execution - Workflow execution detail info
 */
export function printExecutionWithLogs(execution: WorkflowExecutionDetailInfo): void {
  // Helper to format Date as ISO string or "N/A"
  const formatDate = (date: Date | null): string => (date ? date.toISOString() : "N/A");

  // Print execution summary
  const summaryData: [string, string][] = [
    ["id", execution.id],
    ["workflowName", execution.workflowName],
    ["status", execution.status],
    ["jobExecutions", execution.jobExecutions.toString()],
    ["startedAt", formatDate(execution.startedAt)],
    ["finishedAt", formatDate(execution.finishedAt)],
  ];
  logger.out(formatKeyValueTable(summaryData));

  // Print job details with logs
  if (execution.jobDetails && execution.jobDetails.length > 0) {
    logger.log(styles.bold("\nJob Executions:"));
    for (const job of execution.jobDetails) {
      logger.log(styles.info(`\n--- ${job.stackedJobName} ---`));
      logger.log(`  Status: ${job.status}`);
      logger.log(`  Started: ${formatDate(job.startedAt)}`);
      logger.log(`  Finished: ${formatDate(job.finishedAt)}`);

      if (job.logs) {
        logger.log(styles.warning("\n  Logs:"));
        const logLines = job.logs.split("\n");
        for (const line of logLines) {
          logger.log(`    ${line}`);
        }
      }

      if (job.result) {
        logger.log(styles.success("\n  Result:"));
        try {
          const parsed = JSON.parse(job.result);
          logger.log(`    ${JSON.stringify(parsed, null, 2).split("\n").join("\n    ")}`);
        } catch {
          logger.log(`    ${job.result}`);
        }
      }
    }
  }
}

export const executionsCommand = defineAppCommand({
  name: "executions",
  description: "List or get workflow executions.",
  args: z
    .object({
      ...workspaceArgs,
      ...pagedLogArgs,
      "execution-id": arg(z.string().optional(), {
        positional: true,
        description: "Execution ID (if provided, shows details)",
      }),
      "workflow-name": arg(
        z
          .string()
          .regex(
            /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
            "Must be 3-63 lowercase alphanumeric characters or hyphens, starting and ending with alphanumeric",
          )
          .optional(),
        {
          alias: "n",
          description: "Filter by workflow name (list mode only)",
        },
      ),
      status: arg(z.string().optional(), {
        alias: "s",
        description: "Filter by status (list mode only)",
      }),
      ...waitArgs,
      logs: arg(z.boolean().default(false), {
        description: "Display job execution logs (detail mode only)",
      }),
    })
    .strict(),
  run: async (args) => {
    const jsonOutput = logger.jsonMode || args.json;
    if (args.executionId) {
      const interval = parseDuration(args.interval);

      if (!jsonOutput) {
        logger.info(`Execution ID: ${args.executionId}`, { mode: "stream" });
      }

      if (args.wait) {
        const result = await waitForWorkflowExecutionById({
          executionId: args.executionId,
          workspaceId: args["workspace-id"],
          profile: args.profile,
          interval,
          timeout: parseDuration(args.timeout),
          until: args.until,
          showProgress: !jsonOutput,
          trackJobs: true,
        });

        if (args.logs && !jsonOutput) {
          const { execution } = await getWorkflowExecution({
            executionId: args.executionId,
            workspaceId: args["workspace-id"],
            profile: args.profile,
            logs: true,
          });
          printExecutionWithLogs(execution);
        } else if (args.logs) {
          const { execution } = await getWorkflowExecution({
            executionId: args.executionId,
            workspaceId: args["workspace-id"],
            profile: args.profile,
            logs: true,
          });
          const output: WorkflowWaitResult & Pick<WorkflowExecutionDetailInfo, "jobDetails"> = {
            ...result,
            jobDetails: execution.jobDetails,
          };
          logger.out(output);
        } else {
          logger.out(result);
        }

        const failureMessage = getWorkflowWaitFailureMessage(result, args.until);
        if (failureMessage) {
          throw new Error(failureMessage);
        }
        return;
      }

      const { execution } = await getWorkflowExecution({
        executionId: args.executionId,
        workspaceId: args["workspace-id"],
        profile: args.profile,
        interval,
        logs: args.logs,
      });

      if (args.logs && !jsonOutput) {
        printExecutionWithLogs(execution);
      } else {
        logger.out(execution);
      }
    } else {
      const executions = await listWorkflowExecutions({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        workflowName: args["workflow-name"],
        status: args.status,
        order: args.order,
        limit: args.limit,
      });
      logger.out(executions);
    }
  },
});

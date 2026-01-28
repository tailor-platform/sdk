import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, parseDuration, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger, styles } from "../utils/logger";
import { watchExecutorJob } from "./jobs";
import type { JsonObject } from "@bufbuild/protobuf";

export interface TriggerExecutorOptions {
  executorName: string;
  payload?: JsonObject;
  workspaceId?: string;
  profile?: string;
}

export interface TriggerExecutorResult {
  jobId?: string;
}

/**
 * Trigger an executor and return the job ID.
 * @param options - Options for triggering executor
 * @returns Result containing the job ID if available
 */
export async function triggerExecutor(
  options: TriggerExecutorOptions,
): Promise<TriggerExecutorResult> {
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
    const response = await client.triggerExecutor({
      workspaceId,
      executorName: options.executorName,
      payload: options.payload,
    });

    return { jobId: response.jobId };
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`Executor '${options.executorName}' not found.`);
    }
    if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
      throw new Error(`Invalid argument: ${error.message}`);
    }
    throw error;
  }
}

export const triggerCommand = defineCommand({
  meta: {
    name: "trigger",
    description: "Trigger an executor manually",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    executorName: {
      type: "positional",
      description: "Executor name",
      required: true,
    },
    data: {
      type: "string",
      description: "Request body (JSON string)",
      alias: "d",
    },
    header: {
      type: "string",
      description: "Request header (format: 'Key: Value', can be specified multiple times)",
      alias: "H",
    },
    wait: {
      type: "boolean",
      description:
        "Wait for job completion and downstream execution (workflow/function) if applicable",
      default: false,
      alias: "W",
    },
    interval: {
      type: "string",
      description: "Polling interval when using --wait (e.g., '3s', '500ms', '1m')",
      default: "3s",
      alias: "i",
    },
    logs: {
      type: "boolean",
      description: "Display function execution logs after completion (requires --wait)",
      default: false,
      alias: "l",
    },
  },
  run: withCommonArgs(async (args) => {
    let payload: JsonObject | undefined;

    // Parse data (body)
    let body: JsonObject | undefined;
    if (args.data) {
      try {
        body = JSON.parse(args.data);
      } catch {
        throw new Error(`Invalid JSON data: ${args.data}. Please provide a valid JSON string.`);
      }
    }

    // Parse headers (can be string or string[])
    const headers: Record<string, string> = {};
    if (args.header) {
      const headerValues = Array.isArray(args.header) ? args.header : [args.header];
      for (const h of headerValues) {
        const colonIndex = h.indexOf(":");
        if (colonIndex === -1) {
          throw new Error(`Invalid header format: '${h}'. Expected format: 'Key: Value'`);
        }
        const key = h.slice(0, colonIndex).trim();
        const value = h.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    // Build payload if body or headers are provided
    if (body !== undefined || Object.keys(headers).length > 0) {
      payload = {
        body: body ?? {},
        headers,
      };
    }

    const result = await triggerExecutor({
      executorName: args.executorName,
      payload,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (!result.jobId) {
      logger.success(`Executor '${args.executorName}' triggered successfully.`);
      if (args.wait) {
        logger.warn("Cannot watch: job ID not available. The API may need to be updated.");
      }
      return;
    }

    logger.success(
      `Executor '${args.executorName}' triggered successfully. Job ID: ${result.jobId}`,
    );

    if (args.wait) {
      const interval = parseDuration(args.interval as string);
      const watchResult = await watchExecutorJob({
        executorName: args.executorName,
        jobId: result.jobId,
        workspaceId: args["workspace-id"],
        profile: args.profile,
        interval,
        logs: args.logs,
      });

      // Print result
      if (!args.json) {
        logger.log(styles.bold(`\nTarget Type: ${watchResult.targetType}`));
        logger.log(`Job Status: ${watchResult.job.status}`);

        if (watchResult.workflowExecutionId) {
          logger.log(styles.bold("\nWorkflow Execution:"));
          logger.log(`  ID: ${watchResult.workflowExecutionId}`);
          if (watchResult.workflowStatus) {
            logger.log(`  Status: ${watchResult.workflowStatus}`);
          }
          if (watchResult.workflowJobLogs && watchResult.workflowJobLogs.length > 0) {
            for (const jobLog of watchResult.workflowJobLogs) {
              logger.log(styles.bold(`\n  Job: ${jobLog.jobName}`));
              if (jobLog.logs) {
                logger.log(styles.dim("    Logs:"));
                for (const line of jobLog.logs.split("\n")) {
                  logger.log(`      ${line}`);
                }
              }
              if (jobLog.result) {
                logger.log(styles.dim("    Result:"));
                try {
                  const parsed = JSON.parse(jobLog.result);
                  const formatted = JSON.stringify(parsed, null, 2);
                  for (const line of formatted.split("\n")) {
                    logger.log(`      ${line}`);
                  }
                } catch {
                  logger.log(`      ${jobLog.result}`);
                }
              }
            }
          }
        }
        if (watchResult.functionExecutionId) {
          logger.log(styles.bold("\nFunction Execution:"));
          logger.log(`  ID: ${watchResult.functionExecutionId}`);
          if (watchResult.functionStatus) {
            logger.log(`  Status: ${watchResult.functionStatus}`);
          }
          if (watchResult.functionLogs) {
            logger.log(styles.dim("  Logs:"));
            for (const line of watchResult.functionLogs.split("\n")) {
              logger.log(`    ${line}`);
            }
          }
        }
      } else {
        logger.out(watchResult);
      }
    }
  }),
});

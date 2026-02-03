import { Code, ConnectError } from "@connectrpc/connect";
import { ExecutorTriggerType } from "@tailor-proto/tailor/v1/executor_resource_pb";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import {
  commonArgs,
  durationArg,
  headerArg,
  jsonArgs,
  jsonDataArg,
  withCommonArgs,
  workspaceArgs,
} from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger, styles } from "../utils/logger";
import { watchExecutorJob } from "./jobs";
import { executorTriggerTypeToString } from "./status";
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
  name: "trigger",
  description: "Trigger an executor manually.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    executorName: arg(z.string(), {
      positional: true,
      description: "Executor name",
    }),
    data: arg(jsonDataArg.optional(), {
      alias: "d",
      description: "Request body (JSON string)",
    }),
    header: arg(headerArg.array().optional(), {
      alias: "H",
      overrideBuiltinAlias: true,
      description: "Request header (format: 'Key: Value', can be specified multiple times)",
    }),
    wait: arg(z.boolean().default(false), {
      alias: "W",
      description:
        "Wait for job completion and downstream execution (workflow/function) if applicable",
    }),
    interval: arg(durationArg.default(3000), {
      alias: "i",
      description: "Polling interval when using --wait (e.g., '3s', '500ms', '1m')",
    }),
    logs: arg(z.boolean().default(false), {
      alias: "l",
      description: "Display function execution logs after completion (requires --wait)",
    }),
  }),
  run: withCommonArgs(async (args) => {
    // Validate trigger type before processing
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const { executor } = await client.getExecutorExecutor({
      workspaceId,
      name: args.executorName,
    });

    if (!executor) {
      throw new Error(`Executor '${args.executorName}' not found.`);
    }

    // EVENT trigger type cannot be triggered manually
    if (executor.triggerType === ExecutorTriggerType.EVENT) {
      throw new Error(
        `Executor '${args.executorName}' has '${executorTriggerTypeToString(executor.triggerType)}' trigger type and cannot be triggered manually. ` +
          `Only executors with 'incomingWebhook' or 'schedule' triggers can be triggered manually.`,
      );
    }

    // SCHEDULE trigger type does not accept --data or --header options
    if (executor.triggerType === ExecutorTriggerType.SCHEDULE && (args.data || args.header)) {
      throw new Error(
        `Executor '${args.executorName}' has 'schedule' trigger type. ` +
          `The --data and --header options are only available for 'incomingWebhook' trigger type.`,
      );
    }

    let payload: JsonObject | undefined;

    // Build payload if data or headers are provided
    const body: JsonObject | undefined = args.data;
    const headers: Record<string, string> = {};
    if (args.header) {
      for (const h of args.header) {
        headers[h.key] = h.value;
      }
    }

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
      const watchResult = await watchExecutorJob({
        executorName: args.executorName,
        jobId: result.jobId,
        workspaceId: args["workspace-id"],
        profile: args.profile,
        interval: args.interval,
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

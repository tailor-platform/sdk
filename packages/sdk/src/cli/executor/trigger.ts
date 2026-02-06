import { Code, ConnectError } from "@connectrpc/connect";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import {
  commonArgs,
  durationArg,
  jsonArgs,
  parseDuration,
  withCommonArgs,
  workspaceArgs,
} from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../utils/format";
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
 * Trigger an executor manually.
 * @param options - Options for triggering executor
 * @returns Trigger result including job ID
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

    // jobId is available from PR #9939
    const jobId = (response as { jobId?: string }).jobId;

    return { jobId };
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
  description: "Trigger an executor manually",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    executorName: arg(z.string(), {
      positional: true,
      description: "Executor name",
    }),
    payload: arg(z.string().optional(), {
      alias: "d",
      description: "Payload data (JSON string)",
    }),
    watch: arg(z.boolean().default(false), {
      description:
        "Wait for job completion and downstream execution (workflow/function) if applicable",
    }),
    interval: arg(durationArg.default("3s"), {
      description: "Polling interval for --watch (e.g., '3s', '500ms', '1m')",
    }),
  }),
  run: withCommonArgs(async (args) => {
    let payload: JsonObject | undefined;
    if (args.payload) {
      try {
        const parsed = JSON.parse(args.payload);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("JSON payload must be an object, not an array or primitive value");
        }
        payload = parsed;
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error(
            `Invalid JSON payload: ${args.payload}. Please provide a valid JSON string.`,
          );
        }
        throw e;
      }
    }

    const result = await triggerExecutor({
      executorName: args.executorName,
      payload,
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (!result.jobId) {
      logger.success(`Executor '${args.executorName}' triggered successfully.`);
      if (args.watch) {
        logger.warn("Cannot watch: job ID not available. The API may need to be updated.");
      }
      return;
    }

    logger.success(
      `Executor '${args.executorName}' triggered successfully. Job ID: ${result.jobId}`,
    );

    if (args.watch) {
      const interval = parseDuration(args.interval);
      const watchResult = await watchExecutorJob({
        executorName: args.executorName,
        jobId: result.jobId,
        workspaceId: args["workspace-id"],
        profile: args.profile,
        interval,
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
        }
        if (watchResult.functionExecutionId) {
          logger.log(styles.bold("\nFunction Execution:"));
          logger.log(`  ID: ${watchResult.functionExecutionId}`);
          if (watchResult.functionStatus) {
            logger.log(`  Status: ${watchResult.functionStatus}`);
          }
        }
      } else {
        printData(watchResult, args.json);
      }
    }
  }),
});

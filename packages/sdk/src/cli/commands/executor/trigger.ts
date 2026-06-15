import { Code, ConnectError } from "@connectrpc/connect";
import { ExecutorTriggerType } from "@tailor-proto/tailor/v1/executor_resource_pb";
import { arg } from "politty";
import { z } from "zod";
import { durationArg, parseDuration, workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { watchExecutorJob } from "./jobs";
import { executorTriggerTypeToString } from "./status";
import type { IncomingWebhookTrigger, ScheduleTriggerInput } from "@/types/executor.generated";
import type { JsonObject } from "@bufbuild/protobuf";

/**
 * Schema for JSON string validation (object only)
 * Transforms the string to a parsed object
 */
const jsonDataArg = z
  .string()
  .transform((val) => {
    try {
      return JSON.parse(val) as unknown;
    } catch {
      throw new Error(`Invalid JSON data: ${val}. Please provide a valid JSON string.`);
    }
  })
  .refine((v): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v), {
    message: "JSON data must be an object, not an array or primitive value",
  });

/**
 * Schema for header string validation (format: "Key: Value")
 * Transforms the string to an object with key and value properties
 */
const headerArg = z
  .string()
  .superRefine((val, ctx) => {
    if (!val.includes(":")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid header format: '${val}'. Expected format: 'Key: Value'`,
      });
    }
  })
  .transform((val) => {
    const colonIndex = val.indexOf(":");
    return {
      key: val.slice(0, colonIndex).trim(),
      value: val.slice(colonIndex + 1).trim(),
    };
  })
  .refine((h) => h.key.length > 0, {
    message: "Header name cannot be empty",
  });

type ManualTrigger = IncomingWebhookTrigger | ScheduleTriggerInput;

type ManualTriggerExecutor<T extends ManualTrigger = ManualTrigger> = T extends ManualTrigger
  ? {
      name: string;
      trigger: T;
    }
  : never;

type TriggerExecutorBaseOptions<E extends ManualTriggerExecutor> = {
  executor: E;
  workspaceId?: string;
  profile?: string;
};

/**
 * @deprecated Use TriggerExecutorTypedOptions instead.
 */
export interface TriggerExecutorOptions {
  executorName: string;
  payload?: JsonObject;
  workspaceId?: string;
  profile?: string;
}

export type TriggerExecutorTypedOptions<E extends ManualTriggerExecutor = ManualTriggerExecutor> =
  E extends ManualTriggerExecutor<IncomingWebhookTrigger>
    ? TriggerExecutorBaseOptions<E> & { payload?: JsonObject }
    : TriggerExecutorBaseOptions<E> & { payload?: never };

export interface TriggerExecutorResult {
  jobId?: string;
}

async function triggerExecutorByName(
  options: TriggerExecutorOptions,
): Promise<TriggerExecutorResult> {
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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
      throw new Error(`Executor '${options.executorName}' not found.`, { cause: error });
    }
    if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
      throw new Error(`Invalid argument: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Trigger an executor and return the job ID.
 * @param options - Options for triggering executor
 * @returns Result containing the job ID if available
 */
export async function triggerExecutor<E extends ManualTriggerExecutor>(
  options: TriggerExecutorTypedOptions<E>,
): Promise<TriggerExecutorResult>;
export async function triggerExecutor(
  options: TriggerExecutorOptions,
): Promise<TriggerExecutorResult>;
export async function triggerExecutor<E extends ManualTriggerExecutor>(
  options: TriggerExecutorOptions | TriggerExecutorTypedOptions<E>,
): Promise<TriggerExecutorResult> {
  // Keep backward compatibility: if both legacy and typed keys are present, prefer legacy shape.
  if ("executorName" in options) {
    return await triggerExecutorByName(options);
  }

  if (options.executor.trigger.kind !== "incomingWebhook" && options.payload !== undefined) {
    throw new Error(
      `Executor '${options.executor.name}' has '${options.executor.trigger.kind}' trigger type. ` +
        `The payload is only available for 'incomingWebhook' trigger type.`,
    );
  }

  return await triggerExecutorByName({
    executorName: options.executor.name,
    payload: options.payload,
    workspaceId: options.workspaceId,
    profile: options.profile,
  });
}

export const triggerCommand = defineAppCommand({
  name: "trigger",
  description: "Trigger an executor manually.",
  notes: `Only executors with \`INCOMING_WEBHOOK\` or \`SCHEDULE\` trigger types can be triggered manually.
Executors with \`EVENT\` trigger types (such as \`recordCreated\`, \`recordUpdated\`, \`recordDeleted\`) cannot be triggered manually.

The \`--data\` and \`--header\` options are only available for \`INCOMING_WEBHOOK\` trigger type.

**Downstream Execution Tracking**

When using \`--wait\`, the CLI tracks not only the executor job but also any downstream executions:

- **Workflow targets**: Waits for the workflow execution to complete (SUCCESS, FAILED, or PENDING_RESUME). Shows real-time status changes and currently running job names during execution (same output as \`workflow start --wait\`).
- **Function targets**: Waits for the function execution to complete
- **Webhook/GraphQL targets**: Only waits for the executor job itself

The \`--logs\` option displays logs from the downstream execution when available.`,
  examples: [
    { cmd: "my-executor", desc: "Trigger an executor" },
    {
      cmd: 'my-executor -d \'{"message": "hello"}\'',
      desc: "Trigger with data",
    },
    {
      cmd: 'my-executor -d \'{"message": "hello"}\' -H "X-Custom: value" -H "X-Another: value2"',
      desc: "Trigger with data and headers",
    },
    { cmd: "my-executor -W", desc: "Trigger and wait for completion" },
    { cmd: "my-executor -W -l", desc: "Trigger, wait, and show logs" },
  ],
  args: z
    .object({
      ...workspaceArgs,
      "executor-name": arg(z.string(), {
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
      interval: arg(durationArg.default("3s"), {
        alias: "i",
        description: "Polling interval when using --wait (e.g., '3s', '500ms', '1m')",
      }),
      logs: arg(z.boolean().default(false), {
        alias: "l",
        description: "Display function execution logs after completion (requires --wait)",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    // Validate trigger type before processing
    const accessToken = await loadAccessToken({
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
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
          `Only executors with 'INCOMING_WEBHOOK' or 'SCHEDULE' triggers can be triggered manually.`,
      );
    }

    // SCHEDULE trigger type does not accept --data or --header options
    if (executor.triggerType === ExecutorTriggerType.SCHEDULE && (args.data || args.header)) {
      throw new Error(
        `Executor '${args.executorName}' has 'SCHEDULE' trigger type. ` +
          `The --data and --header options are only available for 'INCOMING_WEBHOOK' trigger type.`,
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

    const result = await triggerExecutorByName({
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
        interval: parseDuration(args.interval),
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
  },
});

import {
  DURATION_UNITS,
  durationToSeconds,
  EXECUTION_POLICY_KEY_MESSAGE,
  EXECUTION_POLICY_KEY_PATTERN,
  EXECUTION_POLICY_NAME_MESSAGE,
  EXECUTION_POLICY_NAME_PATTERN,
  RETRY_POLICY_LIMITS,
} from "@tailor-platform/shared/workflow-policy";
import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.strictObject({
  name: z.string().describe("Job name (must be unique across the project)"),
  start: functionSchema.describe("Start function that initiates the job"),
  body: functionSchema.describe("Job implementation function"),
  publishEvents: z
    .boolean()
    .optional()
    .describe("Enable publishing job execution events for this job"),
});

const seconds = (duration: string): number => durationToSeconds(duration) ?? 0;

const baseDurationSchema = z.templateLiteral([z.number().int().positive(), z.enum(DURATION_UNITS)]);

const durationSchema = (maxSeconds: number) =>
  baseDurationSchema.refine((val) => seconds(val) <= maxSeconds, {
    message: `Duration must be at most ${maxSeconds} seconds`,
  });

export const RetryPolicySchema = z
  .strictObject({
    maxRetries: z
      .number()
      .int()
      .min(RETRY_POLICY_LIMITS.maxRetries.min)
      .max(RETRY_POLICY_LIMITS.maxRetries.max)
      .describe("Maximum number of retries (1-10)"),
    initialBackoff: durationSchema(RETRY_POLICY_LIMITS.initialBackoffMaxSeconds).describe(
      "Initial backoff duration (e.g., '1s', '500ms', '1m', max 1h)",
    ),
    maxBackoff: durationSchema(RETRY_POLICY_LIMITS.maxBackoffMaxSeconds).describe(
      "Maximum backoff duration (e.g., '30s', '5m', max 24h)",
    ),
    backoffMultiplier: z
      .number()
      .min(RETRY_POLICY_LIMITS.backoffMultiplierMin)
      .describe("Backoff multiplier (>= 1)"),
  })

  .refine((data) => seconds(data.initialBackoff) <= seconds(data.maxBackoff), {
    message: "initialBackoff must be less than or equal to maxBackoff",
    path: ["initialBackoff"],
  })
  .refine((data) => seconds(data.initialBackoff) > 0, {
    message: "initialBackoff must be greater than 0",
    path: ["initialBackoff"],
  });

export const ConcurrencyPolicySchema = z.strictObject({
  maxConcurrentExecutions: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .describe("Maximum number of concurrent executions (1-1000)"),
});

export const ExecutionPolicyNameSchema = z
  .string()
  .regex(EXECUTION_POLICY_NAME_PATTERN, EXECUTION_POLICY_NAME_MESSAGE)
  .describe("Workspace-unique execution policy name embedded in the resource TRN");

export const ExecutionPolicyKeySchema = z
  .string()
  .regex(EXECUTION_POLICY_KEY_PATTERN, EXECUTION_POLICY_KEY_MESSAGE)
  .describe("Execution policy key passed to execJobFunction's executionPolicyKey option");

export const WorkflowJobFunctionExecutionPolicySchema = z.strictObject({
  name: ExecutionPolicyNameSchema,
  key: ExecutionPolicyKeySchema,
  concurrencyPolicy: ConcurrencyPolicySchema.optional().describe(
    "Optional per-key concurrency cap for job function dispatches matching this policy",
  ),
});

export const WorkflowSchema = z.strictObject({
  name: z.string().describe("Workflow name"),
  mainJob: WorkflowJobSchema.describe("Main job that starts the workflow"),
  retryPolicy: RetryPolicySchema.optional().describe("Retry policy for the workflow"),
  concurrencyPolicy: ConcurrencyPolicySchema.optional().describe(
    "Concurrency policy for the workflow",
  ),
  publishEvents: z
    .boolean()
    .optional()
    .describe("Enable publishing workflow execution events for this workflow"),
});

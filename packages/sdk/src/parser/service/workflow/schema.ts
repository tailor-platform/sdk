import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string().describe("Job name (must be unique across the project)"),
  trigger: functionSchema.describe("Trigger function that initiates the job"),
  body: functionSchema.describe("Job implementation function"),
});

const durationUnits = ["ms", "s", "m"] as const;

const unitToSeconds: Record<(typeof durationUnits)[number], number> = {
  ms: 1 / 1000,
  s: 1,
  m: 60,
};

function durationToSeconds(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m)$/);
  if (!match) return 0;
  const value = match[1];
  const unit = match[2];
  if (value === undefined || unit === undefined) return 0;
  return parseInt(value, 10) * unitToSeconds[unit as (typeof durationUnits)[number]];
}

const baseDurationSchema = z.templateLiteral([z.number().int().positive(), z.enum(durationUnits)]);

const durationSchema = (maxSeconds: number) =>
  baseDurationSchema.refine((val) => durationToSeconds(val) <= maxSeconds, {
    message: `Duration must be at most ${maxSeconds} seconds`,
  });

export const RetryPolicySchema = z
  .object({
    maxRetries: z.number().int().min(1).max(10).describe("Maximum number of retries (1-10)"),
    initialBackoff: durationSchema(3600).describe(
      "Initial backoff duration (e.g., '1s', '500ms', '1m', max 1h)",
    ),
    maxBackoff: durationSchema(86400).describe(
      "Maximum backoff duration (e.g., '30s', '5m', max 24h)",
    ),
    backoffMultiplier: z.number().min(1).describe("Backoff multiplier (>= 1)"),
  })
  .refine((data) => durationToSeconds(data.initialBackoff) <= durationToSeconds(data.maxBackoff), {
    message: "initialBackoff must be less than or equal to maxBackoff",
    path: ["initialBackoff"],
  })
  .refine((data) => durationToSeconds(data.initialBackoff) > 0, {
    message: "initialBackoff must be greater than 0",
    path: ["initialBackoff"],
  });

export const ConcurrencyPolicySchema = z.object({
  maxConcurrentExecutions: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .describe("Maximum number of concurrent executions (1-1000)"),
});

export const ExecutionPolicyNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
    "Invalid execution policy name: must match [a-z0-9-] (3-63 chars; must start and end with [a-z0-9])",
  )
  .describe("Workspace-unique execution policy name embedded in the resource TRN");

export const ExecutionPolicyKeySchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_:.-]{0,62}[a-z0-9*]$/,
    "Invalid execution policy key: must match [a-z0-9_:.-] (2-64 chars; must start with [a-z0-9] and end with [a-z0-9] or a trailing '*')",
  )
  .describe("Execution policy key passed to triggerJobFunction's executionPolicyKey option");

export const WorkflowJobFunctionExecutionPolicySchema = z.object({
  name: ExecutionPolicyNameSchema,
  key: ExecutionPolicyKeySchema,
  concurrencyPolicy: ConcurrencyPolicySchema.optional().describe(
    "Optional per-key concurrency cap for job function dispatches matching this policy",
  ),
});

export const WorkflowSchema = z.object({
  name: z.string().describe("Workflow name"),
  mainJob: WorkflowJobSchema.describe("Main job that starts the workflow"),
  retryPolicy: RetryPolicySchema.optional().describe("Retry policy for the workflow"),
  concurrencyPolicy: ConcurrencyPolicySchema.optional().describe(
    "Concurrency policy for the workflow",
  ),
});

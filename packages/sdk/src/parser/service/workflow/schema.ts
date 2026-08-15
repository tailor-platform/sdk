import * as v from "valibot";
import { functionSchema } from "../common";

export const WorkflowJobSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Job name (must be unique across the project)")),
  start: v.pipe(functionSchema, v.description("Start function that initiates the job")),
  body: v.pipe(functionSchema, v.description("Job implementation function")),
  publishEvents: v.optional(
    v.pipe(v.boolean(), v.description("Enable publishing job execution events for this job")),
  ),
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

type Duration = `${number}${(typeof durationUnits)[number]}`;

const baseDurationSchema = v.custom<Duration>(
  (val) => typeof val === "string" && /^\d+(ms|s|m)$/.test(val),
);

const durationSchema = (maxSeconds: number) =>
  v.pipe(
    baseDurationSchema,
    v.check(
      (val) => durationToSeconds(val) <= maxSeconds,
      `Duration must be at most ${maxSeconds} seconds`,
    ),
  );

export const RetryPolicySchema = v.pipe(
  v.strictObject({
    maxRetries: v.pipe(
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(10),
      v.description("Maximum number of retries (1-10)"),
    ),
    initialBackoff: v.pipe(
      durationSchema(3600),
      v.description("Initial backoff duration (e.g., '1s', '500ms', '1m', max 1h)"),
    ),
    maxBackoff: v.pipe(
      durationSchema(86400),
      v.description("Maximum backoff duration (e.g., '30s', '5m', max 24h)"),
    ),
    backoffMultiplier: v.pipe(
      v.number(),
      v.minValue(1),
      v.description("Backoff multiplier (>= 1)"),
    ),
  }),
  v.forward(
    v.check(
      (data) => durationToSeconds(data.initialBackoff) <= durationToSeconds(data.maxBackoff),
      "initialBackoff must be less than or equal to maxBackoff",
    ),
    ["initialBackoff"],
  ),
  v.forward(
    v.check(
      (data) => durationToSeconds(data.initialBackoff) > 0,
      "initialBackoff must be greater than 0",
    ),
    ["initialBackoff"],
  ),
);

export const ConcurrencyPolicySchema = v.strictObject({
  maxConcurrentExecutions: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(1000),
    v.description("Maximum number of concurrent executions (1-1000)"),
  ),
});

export const ExecutionPolicyNameSchema = v.pipe(
  v.string(),
  v.regex(
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
    "Invalid execution policy name: must match [a-z0-9-] (3-63 chars; must start and end with [a-z0-9])",
  ),
  v.description("Workspace-unique execution policy name embedded in the resource TRN"),
);

export const ExecutionPolicyKeySchema = v.pipe(
  v.string(),
  v.regex(
    /^[a-z0-9][a-z0-9_:.-]{0,62}[a-z0-9*]$/,
    "Invalid execution policy key: must match [a-z0-9_:.-] (2-64 chars; must start with [a-z0-9] and end with [a-z0-9] or a trailing '*')",
  ),
  v.description("Execution policy key passed to execJobFunction's executionPolicyKey option"),
);

export const WorkflowJobFunctionExecutionPolicySchema = v.strictObject({
  name: ExecutionPolicyNameSchema,
  key: ExecutionPolicyKeySchema,
  concurrencyPolicy: v.optional(
    v.pipe(
      ConcurrencyPolicySchema,
      v.description(
        "Optional per-key concurrency cap for job function dispatches matching this policy",
      ),
    ),
  ),
});

export const WorkflowSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Workflow name")),
  mainJob: v.pipe(WorkflowJobSchema, v.description("Main job that starts the workflow")),
  retryPolicy: v.optional(
    v.pipe(RetryPolicySchema, v.description("Retry policy for the workflow")),
  ),
  concurrencyPolicy: v.optional(
    v.pipe(ConcurrencyPolicySchema, v.description("Concurrency policy for the workflow")),
  ),
  publishEvents: v.optional(
    v.pipe(
      v.boolean(),
      v.description("Enable publishing workflow execution events for this workflow"),
    ),
  ),
});

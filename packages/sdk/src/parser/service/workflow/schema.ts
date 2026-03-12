import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string().describe("Job name (must be unique across the project)"),
  trigger: functionSchema.describe("Trigger function that initiates the job"),
  body: functionSchema.describe("Job implementation function"),
});

const durationPattern = /^(\d+)(ms|s|m)$/;

function durationToSeconds(duration: string): number {
  const match = duration.match(durationPattern);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value / 1000;
    case "s":
      return value;
    case "m":
      return value * 60;
    default:
      return 0;
  }
}

const durationSchema = (maxSeconds: number) =>
  z
    .string()
    .regex(durationPattern, "Invalid duration format. Expected format: '1s', '500ms', '1m'")
    .refine((val) => durationToSeconds(val) <= maxSeconds, {
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

export const WorkflowSchema = z.object({
  name: z.string().describe("Workflow name"),
  mainJob: WorkflowJobSchema.describe("Main job that starts the workflow"),
  retryPolicy: RetryPolicySchema.optional().describe("Retry policy for the workflow"),
});

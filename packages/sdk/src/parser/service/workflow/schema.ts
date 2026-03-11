import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string().describe("Job name (must be unique across the project)"),
  trigger: functionSchema.describe("Trigger function that initiates the job"),
  body: functionSchema.describe("Job implementation function"),
});

const durationPattern = /^\d+(ms|s|m)$/;

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().positive().describe("Maximum number of retries"),
  initialBackoff: z
    .string()
    .regex(durationPattern, "Invalid duration format. Expected format: '1s', '500ms', '1m'")
    .optional()
    .describe("Initial backoff duration (e.g., '1s', '500ms', '1m')"),
  maxBackoff: z
    .string()
    .regex(durationPattern, "Invalid duration format. Expected format: '30s', '5m'")
    .optional()
    .describe("Maximum backoff duration (e.g., '30s', '5m')"),
  backoffMultiplier: z.number().positive().optional().describe("Backoff multiplier"),
});

export const WorkflowSchema = z.object({
  name: z.string().describe("Workflow name"),
  mainJob: WorkflowJobSchema.describe("Main job that starts the workflow"),
  retryPolicy: RetryPolicySchema.optional().describe("Retry policy for the workflow"),
});

import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string().describe("Job name (must be unique across the project)"),
  trigger: functionSchema.describe("Trigger function that initiates the job"),
  body: functionSchema.describe("Job implementation function"),
});

export const WorkflowSchema = z.object({
  name: z.string().describe("Workflow name"),
  mainJob: WorkflowJobSchema.describe("Main job that starts the workflow"),
});

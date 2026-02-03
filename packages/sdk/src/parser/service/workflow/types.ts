import type { WorkflowJobSchema, WorkflowSchema } from "./schema";
import type { z } from "zod";

export type WorkflowJob = z.infer<typeof WorkflowJobSchema>;

export type Workflow = z.infer<typeof WorkflowSchema>;

export type WorkflowServiceConfig = {
  files: string[];
  job_files?: string[];
  ignores?: string[];
  job_ignores?: string[];
};

export type WorkflowServiceInput = WorkflowServiceConfig;

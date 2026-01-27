import type { WorkflowJobSchema, WorkflowSchema } from "./schema";
import type { z } from "zod";

export type WorkflowJob = z.infer<typeof WorkflowJobSchema>;

export type Workflow = z.infer<typeof WorkflowSchema>;
export type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

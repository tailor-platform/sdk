import type { WorkflowJobSchema, WorkflowSchema } from "./schema";
import type { z } from "zod";

export type WorkflowJob = z.infer<typeof WorkflowJobSchema>;
export type WorkflowJobInput = z.input<typeof WorkflowJobSchema>;

export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowInput = z.input<typeof WorkflowSchema>;

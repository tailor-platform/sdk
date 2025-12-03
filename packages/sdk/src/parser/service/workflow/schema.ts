import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string(),
  trigger: functionSchema,
  body: functionSchema,
});

export const WorkflowSchema = z.object({
  name: z.string(),
  mainJob: WorkflowJobSchema,
});

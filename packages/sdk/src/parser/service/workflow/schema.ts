import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string(),
  deps: z.array(z.any()).optional(),
  body: functionSchema,
});

export const WorkflowSchema = z.object({
  name: z.string(),
  mainJob: z.lazy(() => WorkflowJobSchema),
});

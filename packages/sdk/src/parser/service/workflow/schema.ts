import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z.object({
  name: z.string(),
  get deps() {
    return z.array(WorkflowJobSchema).optional();
  },
  body: functionSchema,
});

export const WorkflowSchema = z.object({
  name: z.string(),
  mainJob: z.lazy(() => WorkflowJobSchema),
});

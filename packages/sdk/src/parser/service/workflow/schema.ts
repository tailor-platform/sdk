import { z } from "zod";
import { functionSchema } from "../common";

export const WorkflowJobSchema = z
  .object({
    name: z.string(),
    trigger: functionSchema,
    body: functionSchema.optional(),
    scriptRef: z.string().optional(),
  })
  .refine((data) => (data.body !== undefined) !== (data.scriptRef !== undefined), {
    message: "Exactly one of 'body' or 'scriptRef' must be provided",
  });

export const WorkflowSchema = z.object({
  name: z.string(),
  mainJob: WorkflowJobSchema,
});

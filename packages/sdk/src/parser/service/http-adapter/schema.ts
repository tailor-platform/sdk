import { z } from "zod";
import { functionSchema, resourceNameSchema } from "../common";

const inputHandlersSchema = z
  .strictObject({
    get: functionSchema.optional().describe("Handler for GET requests"),
    post: functionSchema.optional().describe("Handler for POST requests"),
    put: functionSchema.optional().describe("Handler for PUT requests"),
    patch: functionSchema.optional().describe("Handler for PATCH requests"),
    delete: functionSchema.optional().describe("Handler for DELETE requests"),
  })

  .refine(
    // optional fields become undefined after zod parses them
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    (val) => Object.values(val).some((v) => v !== undefined),
    "input must declare at least one HTTP method handler",
  )
  .describe("Per-method functions that transform HTTP requests to GraphQL requests");

export const HttpAdapterConfigSchema = z.strictObject({
  name: resourceNameSchema.describe("Unique adapter name within the domain"),
  pathPattern: z
    .string()
    .min(1)
    .describe("Path pattern with segment wildcards (trailing or single-segment)"),
  enabled: z.boolean().default(true).describe("Whether the adapter is active"),
  priority: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Matching priority; the lowest value wins when multiple adapters match"),
  input: inputHandlersSchema,
  output: functionSchema
    .optional()
    .describe("Function that transforms GraphQL response to HTTP response"),
});

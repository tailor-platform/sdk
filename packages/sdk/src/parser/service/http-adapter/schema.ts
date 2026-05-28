import { z } from "zod";
import { functionSchema } from "../common";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const inputHandlersSchema = z
  .strictObject({
    get: functionSchema.optional().describe("Handler for GET requests"),
    post: functionSchema.optional().describe("Handler for POST requests"),
    put: functionSchema.optional().describe("Handler for PUT requests"),
    patch: functionSchema.optional().describe("Handler for PATCH requests"),
    delete: functionSchema.optional().describe("Handler for DELETE requests"),
  })
  .refine(
    (val) => Object.values(val).some((v) => v !== undefined),
    "input must declare at least one HTTP method handler",
  )
  .describe("Per-method functions that transform HTTP requests to GraphQL requests");

export const HttpAdapterConfigSchema = z
  .object({
    name: z
      .string()
      .regex(
        NAME_PATTERN,
        "name must be 3-63 chars, lowercase alphanumeric with hyphens, not starting or ending with a hyphen",
      )
      .describe("Unique adapter name within the domain"),
    pathPattern: z
      .string()
      .min(1)
      .describe("Path pattern with segment wildcards (trailing or single-segment)"),
    enabled: z.boolean().default(true).describe("Whether the adapter is active"),
    priority: z.number().int().min(0).default(0).describe("Matching priority"),
    input: inputHandlersSchema,
    output: functionSchema
      .optional()
      .describe("Function that transforms GraphQL response to HTTP response"),
  })
  .brand("HttpAdapterConfig");

export const HttpAdapterServiceInputSchema = z.object({
  files: z.array(z.string()).min(1).describe("Glob patterns matching HTTP adapter files"),
  ignores: z.array(z.string()).optional().describe("Glob patterns to exclude"),
});

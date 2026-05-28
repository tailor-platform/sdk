import { z } from "zod";
import { functionSchema } from "../common";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

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
    methods: z
      .array(z.enum(HTTP_METHODS))
      .min(1, "methods must contain at least one HTTP method")
      .describe("HTTP methods this adapter handles"),
    enabled: z.boolean().default(true).describe("Whether the adapter is active"),
    priority: z.number().int().min(0).default(0).describe("Matching priority"),
    input: functionSchema.describe("Function that transforms HTTP request to GraphQL request"),
    output: functionSchema
      .optional()
      .describe("Function that transforms GraphQL response to HTTP response"),
  })
  .brand("HttpAdapterConfig");

export const HttpAdapterServiceInputSchema = z.object({
  files: z.array(z.string()).min(1).describe("Glob patterns matching HTTP adapter files"),
  ignores: z.array(z.string()).optional().describe("Glob patterns to exclude"),
});

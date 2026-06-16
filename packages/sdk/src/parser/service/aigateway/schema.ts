import { z } from "zod";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const AUTH_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export const AIGatewaySchema = z
  .object({
    name: z
      .string()
      .regex(NAME_PATTERN, "Must be 3-30 lowercase alphanumeric characters or hyphens")
      .describe("AI Gateway name"),
    authNamespace: z
      .string()
      .regex(AUTH_NAMESPACE_PATTERN, "Must be 3-63 lowercase alphanumeric characters or hyphens")
      .describe("Auth namespace used to resolve request tokens against the workspace's auth"),
    cors: z
      .array(z.string())
      .optional()
      .describe(
        "Allowed CORS origins for browser-based clients. Each entry is `*`, `http(s)://*`, `http(s)://*.example.com`, or `http(s)://app.example.com`, optionally with `:port`. Empty list disables cross-origin access.",
      ),
  })
  .brand("AIGatewayConfig");

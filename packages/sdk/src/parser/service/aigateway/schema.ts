import { z } from "zod";

export const AIGatewaySchema = z
  .object({
    name: z.string().describe("AI Gateway name"),
    authNamespace: z
      .string()
      .describe("Auth namespace used to resolve request tokens against the workspace's auth"),
    cors: z
      .array(z.string())
      .optional()
      .describe(
        "Allowed CORS origins for browser-based clients. Each entry is `*`, `http(s)://*`, `http(s)://*.example.com`, or `http(s)://app.example.com`, optionally with `:port`. Empty list disables cross-origin access.",
      ),
  })
  .brand("AIGatewayConfig");

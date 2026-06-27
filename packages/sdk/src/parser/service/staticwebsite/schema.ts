import { z } from "zod";

export const StaticWebsiteSchema = /* strip unknown keys */ z
  .object({
    name: z.string().describe("Static website name"),
    description: z.string().optional().describe("Static website description"),
    allowedIpAddresses: z
      .array(z.string())
      .optional()
      .describe("IP addresses allowed to access the website"),
    customDomains: z.array(z.string()).optional().describe("Custom domains for the static website"),
  })
  .brand("StaticWebsiteConfig");

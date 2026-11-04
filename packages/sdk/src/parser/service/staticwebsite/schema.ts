import { z } from "zod";

const CustomDomainTransferSchema = z.strictObject({
  domain: z.string().describe("Custom domain to move to another workspace"),
  transferTo: z
    .strictObject({
      workspaceId: z.string().describe("Workspace that receives the domain"),
    })
    .describe("Where the domain should move"),
});

const CustomDomainEntrySchema = z.union([z.string(), CustomDomainTransferSchema]);

// strip unknown keys
export const StaticWebsiteSchema = z.strictObject({
  name: z.string().describe("Static website name"),
  description: z.string().optional().describe("Static website description"),
  allowedIpAddresses: z
    .array(z.string())
    .optional()
    .describe("IP addresses allowed to access the website"),
  customDomains: z
    .array(CustomDomainEntrySchema)
    .superRefine((entries, ctx) => {
      // A domain listed twice is contradictory once an entry can carry a transfer
      // intent, and the planner keys its diff by domain.
      const seen = new Set<string>();
      entries.forEach((entry, index) => {
        const domain = typeof entry === "string" ? entry : entry.domain;
        if (seen.has(domain)) {
          ctx.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate custom domain "${domain}"`,
          });
        }
        seen.add(domain);
      });
    })
    .optional()
    .describe("Custom domains for the static website"),
});

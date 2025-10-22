import { z } from "zod";

export const StaticWebsiteSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    allowedIpAddresses: z.array(z.string()).optional(),
  })
  .brand("StaticWebsiteConfig");

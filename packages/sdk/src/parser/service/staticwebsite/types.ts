import type { StaticWebsiteSchema } from "./schema";
import type { z } from "zod";

export type StaticWebsite = z.output<typeof StaticWebsiteSchema>;
export type StaticWebsiteInput = z.input<typeof StaticWebsiteSchema>;

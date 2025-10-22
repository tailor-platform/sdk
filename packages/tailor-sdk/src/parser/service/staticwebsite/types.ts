import type { z } from "zod";
import type { StaticWebsiteSchema } from "./schema";

export type StaticWebsite = z.output<typeof StaticWebsiteSchema>;
export type StaticWebsiteInput = z.input<typeof StaticWebsiteSchema>;

import { arg } from "@politty/zod";
import { z } from "zod";

// strip unknown keys
export const args = z.object({
  name: arg(z.string().optional(), {
    positional: { named: true },
    description: "Project name",
  }),
  template: arg(z.string().optional(), {
    description: "Template name",
  }),
});

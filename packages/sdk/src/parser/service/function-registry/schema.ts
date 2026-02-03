import { z } from "zod";

export const FunctionRegistryServiceSchema = z.object({
  files: z.array(z.string()),
  ignores: z.array(z.string()).optional(),
});

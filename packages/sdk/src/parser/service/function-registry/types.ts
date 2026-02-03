import type { FunctionRegistryServiceSchema } from "./schema";
import type { z } from "zod";

export type FunctionRegistryServiceConfig = z.infer<typeof FunctionRegistryServiceSchema>;
export type FunctionRegistryServiceInput = z.input<typeof FunctionRegistryServiceSchema>;

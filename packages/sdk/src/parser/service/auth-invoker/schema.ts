import { z } from "zod";

export const AuthInvokerSchema = z.object({
  namespace: z.string().describe("Auth namespace"),
  machineUserName: z.string().describe("Machine user name for authentication"),
});

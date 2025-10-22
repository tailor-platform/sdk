import { z } from "zod";

export const IdPSchema = z
  .object({
    name: z.string(),
    authorization: z.union([
      z.literal("insecure"),
      z.literal("loggedIn"),
      z.object({ cel: z.string() }),
    ]),
    clients: z.array(z.string()),
  })
  .brand("IdPConfig");

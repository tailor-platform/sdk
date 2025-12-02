import { z } from "zod";

export const IdPLangSchema = z.enum(["en", "ja"]);

export const IdPSchema = z
  .object({
    name: z.string(),
    authorization: z.union([
      z.literal("insecure"),
      z.literal("loggedIn"),
      z.object({ cel: z.string() }),
    ]),
    clients: z.array(z.string()),
    lang: IdPLangSchema.optional(),
  })
  .brand("IdPConfig");

import { arg } from "@politty/zod";
import { z } from "zod";

type ArgsShape = Record<string, z.ZodType>;

export const nameArgs = {
  name: arg(z.string(), {
    positional: { named: true },
    description: "Vault name",
  }),
} satisfies ArgsShape;

import { arg } from "politty";
import { z } from "zod";

type ArgsShape = Record<string, z.ZodType>;

export const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Vault name",
  }),
} satisfies ArgsShape;

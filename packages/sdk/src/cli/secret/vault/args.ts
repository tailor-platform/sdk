import { arg } from "politty";
import { z } from "zod";

export const nameArgs = {
  name: arg(z.string(), {
    positional: true,
    description: "Vault name",
  }),
};

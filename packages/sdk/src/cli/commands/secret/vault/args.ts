import { arg } from "@politty/valibot";
import * as v from "valibot";

type ArgsShape = Record<string, v.GenericSchema>;

export const nameArgs = {
  name: arg(v.string(), {
    positional: true,
    description: "Vault name",
  }),
} satisfies ArgsShape;

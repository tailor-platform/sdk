import { defineCommand } from "@politty/zod";
import { currentCommand } from "./current";
import { listCommand } from "./list";
import { patCommand } from "./pat";
import { switchCommand } from "./switch";
import { updateCommand } from "./update";

export const userCommand = defineCommand({
  name: "user",
  description: "Manage Tailor Platform users.",
  subCommands: {
    current: currentCommand,
    list: listCommand,
    switch: switchCommand,
    update: updateCommand,
    pat: patCommand,
  },
  defaultSubCommand: "list",
});

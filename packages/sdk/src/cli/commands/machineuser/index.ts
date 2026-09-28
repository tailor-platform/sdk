import { defineCommand } from "@politty/zod";
import { listCommand } from "./list";
import { tokenCommand } from "./token";

export const machineuserCommand = defineCommand({
  name: "machineuser",
  description: "Manage machine users in your Tailor Platform application.",
  subCommands: {
    list: listCommand,
    token: tokenCommand,
  },
  defaultSubCommand: "list",
});

import { defineCommand } from "@politty/zod";
import { healthCommand } from "./health";
import { listCommand } from "./list";

export const appCommand = defineCommand({
  name: "app",
  description: "Manage workspace applications",
  subCommands: {
    health: healthCommand,
    list: listCommand,
  },
  defaultSubCommand: "list",
});

import { defineCommand, runCommand } from "citty";
import { healthCommand } from "./health";
import { listCommand } from "./list";

export const appCommand = defineCommand({
  meta: {
    name: "app",
    description: "Manage workspace applications",
  },
  subCommands: {
    health: healthCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

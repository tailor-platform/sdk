import { defineCommand, runCommand } from "politty";
import { listCommand } from "./list";

export const pluginCommand = defineCommand({
  name: "plugin",
  description: "Manage and inspect CLI plugins.",
  subCommands: {
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

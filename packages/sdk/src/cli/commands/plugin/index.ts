import { defineCommand, runCommand } from "politty";
import { listCommand } from "./list";

export const pluginCommand = defineCommand({
  name: "plugin",
  description: "Manage and inspect CLI plugins (beta).",
  subCommands: {
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

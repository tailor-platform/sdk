import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { listCommand } from "./list";

export const pluginCommand = defineCommand({
  name: "plugin",
  description: "Manage and inspect CLI plugins (beta).",
  subCommands: {
    list: listCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});

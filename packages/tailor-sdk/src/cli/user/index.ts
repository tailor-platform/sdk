import { defineCommand, runCommand } from "citty";
import { currentCommand } from "./current";
import { listCommand } from "./list";
import { useCommand } from "./use";

export const userCommand = defineCommand({
  meta: {
    name: "user",
    description: "Manage Tailor Platform users",
  },
  subCommands: {
    current: currentCommand,
    list: listCommand,
    use: useCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

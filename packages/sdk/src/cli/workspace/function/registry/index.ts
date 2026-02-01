import { defineCommand, runCommand } from "citty";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const registryCommand = defineCommand({
  meta: {
    name: "registry",
    description: "Manage function registry entries",
  },
  subCommands: {
    get: getCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

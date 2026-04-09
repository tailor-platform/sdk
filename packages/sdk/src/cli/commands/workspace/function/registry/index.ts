import { defineCommand, runCommand } from "politty";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const registryCommand = defineCommand({
  name: "registry",
  description: "Manage function registry entries",
  subCommands: {
    get: getCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

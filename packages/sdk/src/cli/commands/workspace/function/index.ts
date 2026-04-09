import { defineCommand, runCommand } from "politty";
import { getCommand } from "./registry/get";
import { listCommand } from "./registry/list";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage workspace functions",
  subCommands: {
    get: getCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

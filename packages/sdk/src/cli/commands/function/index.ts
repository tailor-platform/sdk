import { defineCommand, runCommand } from "politty";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { logsCommand } from "./logs";
import { runFunctionCommand } from "./run";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    get: getCommand,
    list: listCommand,
    logs: logsCommand,
    run: runFunctionCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

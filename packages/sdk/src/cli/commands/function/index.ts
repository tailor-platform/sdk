import { defineCommand, runCommand } from "politty";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { logsCommand } from "./logs";
import { testRunCommand } from "./test-run";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    get: getCommand,
    list: listCommand,
    logs: logsCommand,
    "test-run": testRunCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

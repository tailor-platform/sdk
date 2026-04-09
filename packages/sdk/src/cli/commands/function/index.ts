import { defineCommand, runCommand } from "politty";
import { logsCommand } from "./logs";
import { getCommand } from "./registry-get";
import { listCommand } from "./registry-list";
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

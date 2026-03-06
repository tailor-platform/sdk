import { defineCommand, runCommand } from "politty";
import { logsCommand } from "./logs";
import { testRunCommand } from "./test-run";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    logs: logsCommand,
    "test-run": testRunCommand,
  },
  async run() {
    await runCommand(logsCommand, []);
  },
});

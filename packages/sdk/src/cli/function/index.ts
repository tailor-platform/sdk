import { defineCommand, runCommand } from "politty";
import { logsCommand } from "./logs";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    logs: logsCommand,
  },
  async run() {
    await runCommand(logsCommand, []);
  },
});

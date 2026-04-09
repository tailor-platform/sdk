import { defineCommand, runCommand } from "politty";
import { logsCommand } from "./logs";
import { getCommand as registryGetCommand } from "./registry-get";
import { listCommand as registryListCommand } from "./registry-list";
import { testRunCommand } from "./test-run";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    get: registryGetCommand,
    list: registryListCommand,
    logs: logsCommand,
    "test-run": testRunCommand,
  },
  async run() {
    await runCommand(registryListCommand, []);
  },
});

import { defineCommand, runCommand } from "politty";
import { deployCommand } from "./deploy";
import { domainCommand } from "./domain";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const staticwebsiteCommand = defineCommand({
  name: "staticwebsite",
  description: "Manage static websites in your workspace.",
  subCommands: {
    deploy: deployCommand,
    domain: domainCommand,
    list: listCommand,
    get: getCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

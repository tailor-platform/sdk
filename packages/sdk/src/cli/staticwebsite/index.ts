import { defineCommand, runCommand } from "citty";
import { deployCommand } from "./deploy";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const staticwebsiteCommand = defineCommand({
  meta: {
    name: "staticwebsite",
    description: "Manage static websites",
  },
  subCommands: {
    deploy: deployCommand,
    get: getCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

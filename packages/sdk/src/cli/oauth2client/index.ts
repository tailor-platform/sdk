import { defineCommand, runCommand } from "citty";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const oauth2clientCommand = defineCommand({
  meta: {
    name: "oauth2client",
    description: "Manage OAuth2 clients",
  },
  subCommands: {
    get: getCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

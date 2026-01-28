import { defineCommand, runCommand } from "politty";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const oauth2clientCommand = defineCommand({
  name: "oauth2client",
  description: "Manage OAuth2 clients",
  subCommands: {
    get: getCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

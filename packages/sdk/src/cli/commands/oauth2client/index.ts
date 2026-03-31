import { defineCommand, runCommand } from "politty";
import { getCommand } from "./get";
import { listCommand } from "./list";

export const oauth2clientCommand = defineCommand({
  name: "oauth2client",
  description: "Manage OAuth2 clients in your Tailor Platform application.",
  subCommands: {
    list: listCommand,
    get: getCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

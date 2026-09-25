import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
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
    await runDefaultSubCommand(listCommand);
  },
});

import { defineCommand, runCommand } from "politty";
import { appCommand } from "./app";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { restoreCommand } from "./restore";
import { userCommand } from "./user";

export const workspaceCommand = defineCommand({
  name: "workspace",
  description: "Manage Tailor Platform workspaces.",
  subCommands: {
    app: appCommand,
    create: createCommand,
    delete: deleteCommand,
    get: getCommand,
    list: listCommand,
    restore: restoreCommand,
    user: userCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

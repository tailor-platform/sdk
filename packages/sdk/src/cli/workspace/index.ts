import { defineCommand, runCommand } from "citty";
import { appCommand } from "./app";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { describeCommand } from "./describe";
import { listCommand } from "./list";
import { restoreCommand } from "./restore";
import { userCommand } from "./user";

export const workspaceCommand = defineCommand({
  meta: {
    name: "workspace",
    description: "Manage Tailor Platform workspaces",
  },
  subCommands: {
    app: appCommand,
    create: createCommand,
    delete: deleteCommand,
    describe: describeCommand,
    list: listCommand,
    restore: restoreCommand,
    user: userCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

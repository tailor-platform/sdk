import { defineCommand, runCommand } from "politty";
import { appCommand } from "./app";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { describeCommand } from "./describe";
import { functionCommand } from "./function";
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
    describe: describeCommand,
    function: functionCommand,
    list: listCommand,
    restore: restoreCommand,
    user: userCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

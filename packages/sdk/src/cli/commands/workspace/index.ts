import { defineCommand, runCommand } from "politty";
import { appCommand } from "./app";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { pruneCommand } from "./prune";
import { restoreCommand } from "./restore";
import { ttlCommand } from "./ttl";
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
    prune: pruneCommand,
    restore: restoreCommand,
    ttl: ttlCommand,
    user: userCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

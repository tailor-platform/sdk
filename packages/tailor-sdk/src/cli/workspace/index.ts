import { defineCommand, runCommand } from "citty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";

export const workspaceCommand = defineCommand({
  meta: {
    name: "workspace",
    description: "Manage Tailor Platform workspaces",
  },
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

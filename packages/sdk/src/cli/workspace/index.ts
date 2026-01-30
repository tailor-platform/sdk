import { defineCommand, runCommand } from "politty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";

export const workspaceCommand = defineCommand({
  name: "workspace",
  description: "Manage Tailor Platform workspaces",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

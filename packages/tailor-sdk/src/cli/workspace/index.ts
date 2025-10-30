import { defineCommand, runCommand } from "citty";
import { createCommand } from "./create";
import { destroyCommand } from "./destroy";
import { listCommand } from "./list";

export const workspaceCommand = defineCommand({
  meta: {
    name: "workspace",
    description: "Manage Tailor Platform workspaces",
  },
  subCommands: {
    create: createCommand,
    destroy: destroyCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

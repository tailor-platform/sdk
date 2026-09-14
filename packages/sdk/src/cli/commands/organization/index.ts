import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { folderCommand } from "./folder";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { treeCommand } from "./tree";
import { updateCommand } from "./update";

export const organizationCommand = defineCommand({
  name: "organization",
  description: "Manage Tailor Platform organizations.",
  subCommands: {
    folder: folderCommand,
    get: getCommand,
    list: listCommand,
    tree: treeCommand,
    update: updateCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});

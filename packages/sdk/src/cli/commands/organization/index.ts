import { defineCommand, runCommand } from "politty";
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
    await runCommand(listCommand, []);
  },
});

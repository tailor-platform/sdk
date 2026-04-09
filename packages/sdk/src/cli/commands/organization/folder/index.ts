import { defineCommand } from "politty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { updateCommand } from "./update";

export const folderCommand = defineCommand({
  name: "folder",
  description: "Manage organization folders.",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    get: getCommand,
    list: listCommand,
    update: updateCommand,
  },
});

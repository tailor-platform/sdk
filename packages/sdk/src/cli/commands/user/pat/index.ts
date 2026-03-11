import { defineCommand, runCommand } from "politty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { updateCommand } from "./update";

export const patCommand = defineCommand({
  name: "pat",
  description: "Manage personal access tokens.",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

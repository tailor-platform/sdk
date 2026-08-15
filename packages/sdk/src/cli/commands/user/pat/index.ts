import { defineCommand, runCommand } from "@politty/valibot";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { updateCommand } from "./update";

export const patCommand = defineCommand({
  name: "pat",
  description: "Manage personal access tokens.",
  subCommands: {
    list: listCommand,
    create: createCommand,
    delete: deleteCommand,
    update: updateCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

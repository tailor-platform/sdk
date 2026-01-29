import { defineCommand } from "politty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { updateCommand } from "./update";

export const patCommand = defineCommand({
  name: "pat",
  description: "Manage personal access tokens",
  args: listCommand.args,
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
  },
  async run(args) {
    // Default to list when no subcommand is provided
    await listCommand.run(args);
  },
});

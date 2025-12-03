import { defineCommand, runCommand } from "citty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";

export const vaultCommand = defineCommand({
  meta: {
    name: "vault",
    description: "Manage Secret Manager vaults",
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

import { defineCommand, runCommand } from "politty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";

export const vaultCommand = defineCommand({
  name: "vault",
  description: "Manage Secret Manager vaults",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

import { defineCommand, runCommand } from "citty";
import { createCommand } from "./create";
import { listCommand } from "./list";

export const vaultCommand = defineCommand({
  meta: {
    name: "vault",
    description: "Manage Secret Manager vaults",
  },
  subCommands: {
    create: createCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

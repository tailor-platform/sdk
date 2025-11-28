import { defineCommand, runCommand } from "citty";
import { listCommand } from "./list";

export const vaultCommand = defineCommand({
  meta: {
    name: "vault",
    description: "Manage Secret Manager vaults",
  },
  subCommands: {
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

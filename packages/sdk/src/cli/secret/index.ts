import { defineCommand, runCommand } from "citty";
import { vaultCommand } from "./vault";

export const secretCommand = defineCommand({
  meta: {
    name: "secret",
    description: "Manage secrets and vaults",
  },
  subCommands: {
    vault: vaultCommand,
  },
  async run() {
    await runCommand(vaultCommand, { rawArgs: [] });
  },
});

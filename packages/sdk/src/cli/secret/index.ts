import { defineCommand, runCommand } from "citty";
import { createSecretCommand } from "./create";
import { updateSecretCommand } from "./update";
import { vaultCommand } from "./vault";

export const secretCommand = defineCommand({
  meta: {
    name: "secret",
    description: "Manage secrets and vaults",
  },
  subCommands: {
    create: createSecretCommand,
    update: updateSecretCommand,
    vault: vaultCommand,
  },
  async run() {
    await runCommand(vaultCommand, { rawArgs: [] });
  },
});

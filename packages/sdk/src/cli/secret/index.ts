import { defineCommand, runCommand } from "politty";
import { createSecretCommand } from "./create";
import { deleteSecretCommand } from "./delete";
import { listSecretCommand } from "./list";
import { updateSecretCommand } from "./update";
import { vaultCommand } from "./vault";

export const secretCommand = defineCommand({
  name: "secret",
  description: "Manage secrets and vaults",
  subCommands: {
    create: createSecretCommand,
    delete: deleteSecretCommand,
    list: listSecretCommand,
    update: updateSecretCommand,
    vault: vaultCommand,
  },
  async run() {
    await runCommand(vaultCommand, []);
  },
});

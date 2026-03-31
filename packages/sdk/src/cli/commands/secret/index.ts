import { defineCommand, runCommand } from "politty";
import { createSecretCommand } from "./create";
import { deleteSecretCommand } from "./delete";
import { listSecretCommand } from "./list";
import { updateSecretCommand } from "./update";
import { vaultCommand } from "./vault";

export const secretCommand = defineCommand({
  name: "secret",
  description: "Manage Secret Manager vaults and secrets.",
  subCommands: {
    vault: vaultCommand,
    create: createSecretCommand,
    update: updateSecretCommand,
    list: listSecretCommand,
    delete: deleteSecretCommand,
  },
  async run() {
    await runCommand(vaultCommand, []);
  },
});

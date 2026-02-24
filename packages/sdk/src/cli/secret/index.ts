import { defineCommand, runCommand } from "politty";
import { createSecretCommand } from "./create";
import { deleteSecretCommand } from "./delete";
import { importSecretCommand } from "./import";
import { listSecretCommand } from "./list";
import { updateSecretCommand } from "./update";
import { vaultCommand } from "./vault";

export const secretCommand = defineCommand({
  name: "secret",
  description: "Manage Secret Manager vaults and secrets.",
  subCommands: {
    create: createSecretCommand,
    delete: deleteSecretCommand,
    import: importSecretCommand,
    list: listSecretCommand,
    update: updateSecretCommand,
    vault: vaultCommand,
  },
  async run() {
    await runCommand(vaultCommand, []);
  },
});

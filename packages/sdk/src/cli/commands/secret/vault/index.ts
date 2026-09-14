import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";

export const vaultCommand = defineCommand({
  name: "vault",
  description: "Manage Secret Manager vaults.",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});

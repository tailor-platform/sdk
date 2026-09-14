import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { updateCommand } from "./update";

export type { ProfileInfo } from "./types";

export const profileCommand = defineCommand({
  name: "profile",
  description: "Manage workspace profiles (user + workspace combinations).",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});

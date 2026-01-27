import { defineCommand, runCommand } from "citty";
import { inviteCommand } from "./invite";
import { listCommand } from "./list";
import { removeCommand } from "./remove";
import { updateCommand } from "./update";

export const userCommand = defineCommand({
  meta: {
    name: "user",
    description: "Manage workspace users",
  },
  subCommands: {
    invite: inviteCommand,
    list: listCommand,
    remove: removeCommand,
    update: updateCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});

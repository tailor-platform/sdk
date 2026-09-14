import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { clearCommand } from "./clear";
import { setCommand } from "./set";

export const ttlCommand = defineCommand({
  name: "ttl",
  description: "Manage when a workspace becomes prunable.",
  subCommands: {
    set: setCommand,
    clear: clearCommand,
  },
  async run() {
    await runDefaultSubCommand(ttlCommand, ["--help"]);
  },
});

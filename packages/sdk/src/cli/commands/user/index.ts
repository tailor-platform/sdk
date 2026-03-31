import { defineCommand, runCommand } from "politty";
import { currentCommand } from "./current";
import { listCommand } from "./list";
import { patCommand } from "./pat";
import { switchCommand } from "./switch";

export const userCommand = defineCommand({
  name: "user",
  description: "Manage Tailor Platform users.",
  subCommands: {
    current: currentCommand,
    list: listCommand,
    switch: switchCommand,
    pat: patCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});

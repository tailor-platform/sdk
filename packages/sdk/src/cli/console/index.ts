import { defineCommand } from "citty";
import { openCommand } from "./open";

export const consoleCommand = defineCommand({
  meta: {
    name: "console",
    description: "Open Tailor Platform Console",
  },
  subCommands: {
    open: openCommand,
  },
});

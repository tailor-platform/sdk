import { defineCommand } from "citty";
import { registryCommand } from "./registry";

export const functionCommand = defineCommand({
  meta: {
    name: "function",
    description: "Manage workspace functions",
  },
  subCommands: {
    registry: registryCommand,
  },
});

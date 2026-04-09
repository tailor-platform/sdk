import { defineCommand } from "politty";
import { registryCommand } from "./registry";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage workspace functions",
  subCommands: {
    registry: registryCommand,
  },
});

import { defineCommand } from "politty";
// import { registryCommand } from "./registry";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage workspace functions",
  subCommands: {
    // The implementation of Registry get-type commands is complete, but currently the registry is not deployed,
    // resulting in always returning 0 records. This command will be enabled after the fix.
    // registry: registryCommand,
  },
});

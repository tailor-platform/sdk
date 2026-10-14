import { defineCommand } from "@politty/zod";
import { cloneCommand } from "./clone";
import { operationCommand } from "./operation";

export const dataCommand = defineCommand({
  name: "data",
  description: "Manage application data across workspaces.",
  subCommands: {
    clone: cloneCommand,
    operation: operationCommand,
  },
});

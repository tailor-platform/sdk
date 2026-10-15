import { defineCommand } from "@politty/zod";
import { getCommand } from "./get";

export const operationCommand = defineCommand({
  name: "operation",
  description: "Inspect asynchronous application data operations.",
  subCommands: {
    get: getCommand,
  },
});

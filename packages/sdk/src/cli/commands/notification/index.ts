import { defineCommand } from "@politty/zod";
import { dismissCommand } from "./dismiss";
import { listCommand } from "./list";
import { readCommand } from "./read";

export const notificationCommand = defineCommand({
  name: "notification",
  description: "Read the platform notifications sent to you.",
  subCommands: {
    list: listCommand,
    read: readCommand,
    dismiss: dismissCommand,
  },
  defaultSubCommand: "list",
});

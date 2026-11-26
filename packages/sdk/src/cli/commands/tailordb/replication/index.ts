import { defineCommand } from "@politty/zod";
import { destinationCommand } from "./destination";
import { listCommand } from "./list";
import { repairCommand } from "./repair";
import { statusCommand } from "./status";

export const replicationCommand = defineCommand({
  name: "replication",
  description: "Inspect and repair replications of TailorDB tables into BigQuery.",
  subCommands: {
    list: listCommand,
    status: statusCommand,
    repair: repairCommand,
    destination: destinationCommand,
  },
});

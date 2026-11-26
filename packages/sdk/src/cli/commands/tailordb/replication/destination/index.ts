import { defineCommand } from "@politty/zod";
import { listCommand } from "./list";

export const destinationCommand = defineCommand({
  name: "destination",
  description: "Inspect the BigQuery datasets TailorDB replications write into.",
  subCommands: {
    list: listCommand,
  },
});

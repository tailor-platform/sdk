import { defineCommand } from "citty";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";

export const erdCommand = defineCommand({
  meta: {
    name: "erd",
    description: "ERD utilities for TailorDB",
  },
  subCommands: {
    export: erdExportCommand,
    serve: erdServeCommand,
  },
});

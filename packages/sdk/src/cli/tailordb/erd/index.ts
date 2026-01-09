import { defineCommand } from "citty";
import { erdExportCommand } from "./export";

export const erdCommand = defineCommand({
  meta: {
    name: "erd",
    description: "ERD utilities for TailorDB",
  },
  subCommands: {
    export: erdExportCommand,
  },
});

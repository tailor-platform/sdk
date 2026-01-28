import { defineCommand } from "politty";
import { erdDeployCommand } from "./deploy";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";

export const erdCommand = defineCommand({
  name: "erd",
  description: "ERD utilities for TailorDB (beta)",
  subCommands: {
    export: erdExportCommand,
    serve: erdServeCommand,
    deploy: erdDeployCommand,
  },
});

import { defineCommand } from "politty";
import { erdDeployCommand } from "./deploy";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";

export const erdCommand = defineCommand({
  name: "erd",
  description: "Generate ERD artifacts for TailorDB namespaces using Liam ERD. (beta)",
  subCommands: {
    export: erdExportCommand,
    serve: erdServeCommand,
    deploy: erdDeployCommand,
  },
});

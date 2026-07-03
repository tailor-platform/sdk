import { defineCommand } from "politty";
import { erdDeployCommand } from "./deploy";
import { erdDiffCommand } from "./diff-command";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";

export const erdCommand = defineCommand({
  name: "erd",
  description: "Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta)",
  subCommands: {
    export: erdExportCommand,
    diff: erdDiffCommand,
    serve: erdServeCommand,
    deploy: erdDeployCommand,
  },
});

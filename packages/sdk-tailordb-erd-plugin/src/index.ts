#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "politty";
import { z } from "zod";
import { erdDeployCommand } from "./deploy";
import { erdDiffCommand } from "./diff-command";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";
import { commonArgs } from "./shared/args";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await readPackageJSON(packageRoot);

const mainCommand = defineCommand({
  name: "tailor-tailordb-erd",
  description:
    "Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta)\n" +
    "Tailor CLI plugin: installed alongside the Tailor CLI, it runs as `tailor tailordb erd <command>`.",
  subCommands: {
    export: erdExportCommand,
    diff: erdDiffCommand,
    serve: erdServeCommand,
    deploy: erdDeployCommand,
  },
});

void runMain(mainCommand, {
  version: packageJson.version ?? "0.0.0",
  // strip unknown keys
  globalArgs: z.object(commonArgs),
});

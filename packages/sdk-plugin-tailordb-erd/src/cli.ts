#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  annotateTerminalError,
  createCommonArgs,
  loadEnvFilesFromArgv,
  logger,
  defineCommand,
  runMain,
  serializeError,
} from "@tailor-platform/sdk/cli";
import { reportPluginError } from "@tailor-platform/shared/plugin-error";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { z } from "zod";
import { erdDeployCommand } from "./deploy";
import { erdDiffCommand } from "./diff-command";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";
import { locatedMessage } from "./utils";

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
  globalArgs: z.strictObject(createCommonArgs()),
  displayErrors: false,
  setup: () => loadEnvFilesFromArgv(process.argv.slice(2)),
  // Render errors like the host CLI does: a JSON envelope under --json, the CLIError format otherwise.
  cleanup: ({ error }) =>
    reportPluginError(error, { logger, serializeError, annotateTerminalError, locatedMessage }),
});

#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  annotateTerminalError,
  createCommonArgs,
  logger,
  defineCommand,
  runMain,
  serializeError,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { z } from "zod";
import { erdDeployCommand } from "./deploy";
import { erdDiffCommand } from "./diff-command";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";

function hasFormat(error: unknown): error is { format(): string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { format?: unknown }).format === "function"
  );
}

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
  // Render errors like the host CLI does: a JSON envelope under --json, the CLIError format otherwise.
  cleanup: ({ error }) => {
    if (!error) return;
    if (logger.jsonMode) {
      logger.log(serializeError(error, { includeStack: logger.verbose }));
    } else if (hasFormat(error)) {
      logger.log(error.format());
    } else if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error(`Unknown error: ${String(error)}`);
    }
    if (!logger.jsonMode && error instanceof Error && error.stack) {
      logger.debug(`\nStack trace:\n${error.stack}`);
    }
    annotateTerminalError(error, { jsonMode: logger.jsonMode });
  },
});

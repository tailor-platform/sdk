#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "@politty/valibot";
import { commonArgs } from "@tailor-platform/shared/args";
import { logger } from "@tailor-platform/shared/logger";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import * as v from "valibot";
import { erdDeployCommand } from "./deploy";
import { erdDiffCommand } from "./diff-command";
import { erdExportCommand } from "./export";
import { erdServeCommand } from "./serve";

function formatValiError(error: v.ValiError<v.GenericSchema>): string {
  const flat = v.flatten(error.issues);
  const lines: string[] = [...(flat.root ?? [])];
  for (const [fieldPath, messages] of Object.entries(flat.nested ?? {})) {
    for (const message of messages ?? []) {
      lines.push(`${fieldPath}: ${message}`);
    }
  }
  return lines.join("\n");
}

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
  // strip unknown keys
  globalArgs: v.object(commonArgs()),
  displayErrors: false,
  // Render the SDK's CLIError format (details/suggestion) like the host CLI does.
  cleanup: ({ error }) => {
    if (!error) return;
    if (error instanceof v.ValiError) {
      logger.log(formatValiError(error));
    } else if (hasFormat(error)) {
      logger.log(error.format());
    } else if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error(`Unknown error: ${String(error)}`);
    }
    if (error instanceof Error && error.stack) {
      logger.debug(`\nStack trace:\n${error.stack}`);
    }
  },
});

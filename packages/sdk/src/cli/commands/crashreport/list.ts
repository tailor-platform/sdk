import * as fs from "node:fs";
import * as path from "pathe";
import { z } from "zod";
import { parseCrashReportConfig } from "@/cli/crashreport/config";
import { CRASH_LOG_EXTENSION } from "@/cli/crashreport/writer";
import { type Order, paginationArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";

export function orderAndLimitCrashReports(
  entries: string[],
  options: { order?: Order; limit?: number },
): string[] {
  const sorted = entries.filter((f) => f.endsWith(CRASH_LOG_EXTENSION)).toSorted();
  const ordered = options.order === "asc" ? sorted : sorted.toReversed();
  return options.limit && options.limit > 0 ? ordered.slice(0, options.limit) : ordered;
}

function formatCrashReportFiles(files: string[], localDir: string) {
  return files.map((file) => ({
    file,
    path: path.join(localDir, file),
  }));
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List local crash report files.",
  args: z
    .object({
      ...paginationArgs(),
    })
    .strict(),
  run: async (args) => {
    const config = parseCrashReportConfig();
    const jsonOutput = logger.jsonMode;
    if (!config.localDir) {
      logger.info("Crash report directory not available.");
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(config.localDir);
    } catch {
      logger.info("No crash reports found.");
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    const files = orderAndLimitCrashReports(entries, { order: args.order, limit: args.limit });

    if (files.length === 0) {
      logger.info("No crash reports found.");
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    if (jsonOutput) {
      logger.out(formatCrashReportFiles(files, config.localDir));
      return;
    }

    logger.info(`${files.length} crash report(s) in ${config.localDir}:`);
    for (const file of files) {
      logger.log(`  ${file}`);
    }
  },
});

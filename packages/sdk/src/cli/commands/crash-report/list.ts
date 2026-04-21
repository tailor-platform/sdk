import * as fs from "node:fs";
import { z } from "zod";
import { parseCrashReportConfig } from "@/cli/crash-report/config";
import { CRASH_LOG_EXTENSION } from "@/cli/crash-report/writer";
import { paginationArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";

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
    if (!config.localDir) {
      logger.info("Crash report directory not available.");
      return;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(config.localDir);
    } catch {
      logger.info("No crash reports found.");
      return;
    }

    const sorted = entries.filter((f) => f.endsWith(CRASH_LOG_EXTENSION)).sort();
    const ordered = args.order === "asc" ? sorted : sorted.reverse();
    const files = args.limit && args.limit > 0 ? ordered.slice(0, args.limit) : ordered;

    if (files.length === 0) {
      logger.info("No crash reports found.");
      return;
    }

    logger.info(`${files.length} crash report(s) in ${config.localDir}:`);
    for (const file of files) {
      logger.log(`  ${file}`);
    }
  },
});

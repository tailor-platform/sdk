import * as fs from "node:fs";
import { defineCommand } from "politty";
import { z } from "zod";
import { parseCrashReportConfig } from "@/cli/crash-report/config";
import { commonArgs, withCommonArgs } from "@/cli/shared/args";
import { logger } from "@/cli/shared/logger";

export const listCommand = defineCommand({
  name: "list",
  description: "List local crash report files.",
  args: z
    .object({
      ...commonArgs,
    })
    .strict(),
  run: withCommonArgs(async () => {
    const config = parseCrashReportConfig();
    if (!config.localDir) {
      logger.info("Crash report directory not available.");
      return;
    }

    if (!fs.existsSync(config.localDir)) {
      logger.info("No crash reports found.");
      return;
    }

    const files = fs
      .readdirSync(config.localDir)
      .filter((f) => f.endsWith(".crash.log"))
      .sort()
      .reverse();

    if (files.length === 0) {
      logger.info("No crash reports found.");
      return;
    }

    logger.info(`${files.length} crash report(s) in ${config.localDir}:`);
    for (const file of files) {
      logger.log(`  ${file}`);
    }
  }),
});

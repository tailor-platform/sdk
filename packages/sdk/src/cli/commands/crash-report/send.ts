import * as fs from "node:fs";
import { arg, defineCommand } from "politty";
import { z } from "zod";
import { sendCrashReport } from "@/cli/crash-report/sender";
import { commonArgs, withCommonArgs } from "@/cli/shared/args";
import { userAgent } from "@/cli/shared/client";
import { logger } from "@/cli/shared/logger";
import type { CrashReport } from "@/cli/crash-report/report";

export const sendCommand = defineCommand({
  name: "send",
  description: "Submit a crash report to help improve the SDK.",
  args: z
    .object({
      ...commonArgs,
      file: arg(z.string(), {
        description: "Path to the crash report file",
        required: true,
        completion: { type: "file", extensions: ["log"] },
      }),
    })
    .strict(),
  run: withCommonArgs(async (args) => {
    const filePath = args.file;

    if (!fs.existsSync(filePath)) {
      logger.error(`Crash report file not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");

    // Parse the crash report from the text file back to JSON
    const report = parseCrashLogFile(content);
    if (!report) {
      logger.error("Failed to parse crash report file. The file may be corrupted.");
      process.exit(1);
    }

    const ua = await userAgent();
    logger.info("Sending crash report...");
    const success = await sendCrashReport(report, ua);

    if (success) {
      logger.success("Crash report submitted successfully. Thank you!");
    } else {
      logger.error("Failed to submit crash report. The server may be unavailable.");
      process.exit(1);
    }
  }),
});

/**
 * Parse a crash log file back into a CrashReport object.
 * Reads the embedded JSON footer appended by formatCrashReport.
 * @param content - File content
 * @returns Parsed report or undefined if parsing fails
 */
export function parseCrashLogFile(content: string): CrashReport | undefined {
  try {
    const marker = "\n--- JSON ---\n";
    const lastIdx = content.lastIndexOf(marker);
    if (lastIdx === -1) return undefined;
    const jsonLine = content.slice(lastIdx + marker.length).split("\n")[0];
    if (!jsonLine) return undefined;
    return JSON.parse(jsonLine) as CrashReport;
  } catch {
    return undefined;
  }
}

import * as fs from "node:fs";
import { arg } from "politty";
import { z } from "zod";
import { sendCrashReport } from "@/cli/crashreport/sender";
import { JSON_FOOTER_MARKER } from "@/cli/crashreport/writer";
import { userAgent } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";
import type { CrashReport } from "@/cli/crashreport/report";

export const sendCommand = defineAppCommand({
  name: "send",
  description: "Submit a crash report to help improve the SDK.",
  args: z
    .object({
      file: arg(z.string(), {
        description: "Path to the crash report file",
        required: true,
        completion: { type: "file", extensions: ["log"] },
      }),
    })
    .strict(),
  run: async (args) => {
    let content: string;
    try {
      content = fs.readFileSync(args.file, "utf-8");
    } catch {
      logger.error(`Crash report file not found: ${args.file}`);
      process.exit(1);
    }

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
  },
});

/**
 * Parse a crash log file back into a CrashReport object.
 * Reads the embedded JSON footer appended by formatCrashReport.
 * @param content - File content
 * @returns Parsed report or undefined if parsing fails
 */
export function parseCrashLogFile(content: string): CrashReport | undefined {
  try {
    const normalized = content.replace(/\r\n/g, "\n");
    const marker = `\n${JSON_FOOTER_MARKER}\n`;
    const lastIdx = normalized.lastIndexOf(marker);
    if (lastIdx === -1) return undefined;
    const jsonLine = normalized.slice(lastIdx + marker.length).split("\n")[0];
    if (!jsonLine) return undefined;
    return JSON.parse(jsonLine) as CrashReport;
  } catch {
    return undefined;
  }
}

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
 * Parse a human-readable crash log file back into a CrashReport object.
 * @param content - File content
 * @returns Parsed report or undefined if parsing fails
 */
function parseCrashLogFile(content: string): CrashReport | undefined {
  try {
    const get = (label: string): string => {
      const re = new RegExp(`^${label}:\\s*(.+)$`, "m");
      return content.match(re)?.[1]?.trim() ?? "";
    };

    const getMultiline = (label: string, endMarker: string): string => {
      const re = new RegExp(`^${label}:\\s*(.*?)\\n(?=\\n--- ${endMarker} ---)`, "ms");
      const match = content.match(re);
      return match?.[1]?.trim() ?? get(label);
    };

    const stackMatch = content.match(/--- Stack Trace ---\n([\s\S]*?)$/);
    const stackTrace = stackMatch?.[1]?.trim() ?? "";

    const osParts = get("OS").split(" ");
    const report: CrashReport = {
      id: get("Crash Report"),
      timestamp: get("Timestamp"),
      sdkVersion: get("SDK Version"),
      nodeVersion: get("Node Version"),
      osPlatform: osParts[0] ?? "",
      osRelease: osParts.slice(1).join(" "),
      arch: get("Arch"),
      command: get("Command"),
      argv: parseArgv(get("Arguments")),
      errorName: get("Name"),
      errorMessage: getMultiline("Message", "Stack Trace"),
      stackTrace: stackTrace === "(no stack trace available)" ? "" : stackTrace,
      errorType: get("Error Type") as CrashReport["errorType"],
    };

    if (!report.id || !report.timestamp || !report.errorType) {
      return undefined;
    }

    return report;
  } catch {
    return undefined;
  }
}

function parseArgv(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed as string[];
    }
  } catch {
    // Fall back to space-separated for older crash log files
  }
  return raw.split(" ");
}

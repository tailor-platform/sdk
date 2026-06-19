import * as fs from "node:fs";
import * as path from "pathe";
import { ensureSecretDir, writeSecretFile } from "@/cli/shared/secret-file";
import type { CrashReport } from "./report";

const MAX_CRASH_FILES = 10;

/** Marker line that separates human-readable content from the JSON footer. */
export const JSON_FOOTER_MARKER = "--- JSON ---";

/** File extension for crash log files. */
export const CRASH_LOG_EXTENSION = ".crash.log";

/**
 * Format a CrashReport as human-readable text for local crash log files.
 * @param report - Crash report to format
 * @returns Formatted text content
 */
export function formatCrashReport(report: CrashReport): string {
  const lines = [
    `Crash Report: ${report.id}`,
    `Timestamp: ${report.timestamp}`,
    `Error Type: ${report.errorType}`,
    "",
    "--- Environment ---",
    `SDK Version: ${report.sdkVersion}`,
    `Node Version: ${report.nodeVersion}`,
    `OS: ${report.osPlatform} ${report.osRelease}`,
    `Arch: ${report.arch}`,
    "",
    "--- Command ---",
    `Command: ${report.command}`,
    `Arguments: ${JSON.stringify(report.argv)}`,
    "",
    "--- Error ---",
    `Name: ${report.errorName}`,
    `Message: ${report.errorMessage}`,
    "",
    "--- Stack Trace ---",
    report.stackTrace || "(no stack trace available)",
    "",
    JSON_FOOTER_MARKER,
    JSON.stringify(report),
    "",
  ];
  return lines.join("\n");
}

/**
 * Generate a filename for a crash log file.
 * Format: {timestamp}-{shortId}.crash.log
 * @param report - Crash report to generate filename for
 * @returns Filename string
 */
function generateFilename(report: CrashReport): string {
  const safeTimestamp = report.timestamp.replace(/[:.]/g, "-");
  const shortId = report.id.slice(0, 8);
  return `${safeTimestamp}-${shortId}${CRASH_LOG_EXTENSION}`;
}

/**
 * Remove old crash log files, keeping only the most recent ones.
 * @param dir - Crash log directory
 */
function cleanupOldFiles(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(CRASH_LOG_EXTENSION))
      .toSorted()
      .toReversed();

    for (const file of files.slice(MAX_CRASH_FILES)) {
      fs.unlinkSync(path.join(dir, file));
    }
  } catch {
    // Best-effort cleanup, ignore errors
  }
}

/**
 * Write a crash report to a local file.
 * Creates the directory if it doesn't exist. Keeps only the last 10 crash files.
 * Never throws - returns the file path on success or undefined on failure.
 * @param report - Crash report to write
 * @param dir - Directory to write the crash log file to
 * @returns File path on success, undefined on failure
 */
export function writeCrashReport(report: CrashReport, dir: string): string | undefined {
  try {
    ensureSecretDir(dir);

    const filename = generateFilename(report);
    const filePath = path.join(dir, filename);
    const content = formatCrashReport(report);

    writeSecretFile(filePath, content);
    cleanupOldFiles(dir);

    return filePath;
  } catch {
    return undefined;
  }
}

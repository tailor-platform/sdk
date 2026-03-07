import * as fs from "node:fs";
import * as path from "pathe";
import type { CrashReport } from "./report";

const MAX_CRASH_FILES = 10;

/**
 * Format a CrashReport as human-readable text for local crash log files.
 * @param report - Crash report to format
 * @returns Formatted text content
 */
export function formatCrashReport(report: CrashReport): string {
  const lines = [
    `Crash Report: ${report.id}`,
    `Timestamp: ${report.timestamp}`,
    `Crash Type: ${report.crashType}`,
    "",
    "--- Environment ---",
    `SDK Version: ${report.sdkVersion}`,
    `Node Version: ${report.nodeVersion}`,
    `OS: ${report.osPlatform} ${report.osRelease}`,
    `Arch: ${report.arch}`,
    "",
    "--- Command ---",
    `Command: ${report.command}`,
    `Arguments: ${report.argv.join(" ")}`,
    "",
    "--- Error ---",
    `Name: ${report.errorName}`,
    `Message: ${report.errorMessage}`,
    "",
    "--- Stack Trace ---",
    report.stackTrace || "(no stack trace available)",
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
  return `${safeTimestamp}-${shortId}.crash.log`;
}

/**
 * Remove old crash log files, keeping only the most recent ones.
 * @param dir - Crash log directory
 */
function cleanupOldFiles(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".crash.log"))
      .sort()
      .reverse();

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
    fs.mkdirSync(dir, { recursive: true });

    const filename = generateFilename(report);
    const filePath = path.join(dir, filename);
    const content = formatCrashReport(report);

    fs.writeFileSync(filePath, content, "utf-8");
    cleanupOldFiles(dir);

    return filePath;
  } catch {
    return undefined;
  }
}

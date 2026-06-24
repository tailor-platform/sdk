import { logger } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";
import { userAgentFromVersion } from "#/cli/shared/user-agent";
import { parseCrashReportConfig } from "./config";
import { buildCrashReport, type ErrorType } from "./report";
import { sendCrashReport } from "./sender";
import { writeCrashReport } from "./writer";

/**
 * Report an unexpected crash. Writes a local crash log file and optionally
 * sends the report to a remote endpoint. Displays a user-facing message
 * with the crash log path and a command to submit the report.
 *
 * Never throws - all errors are silently caught.
 * @param error - The error that caused the crash
 * @param errorType - How the error was caught
 */
export async function reportCrash(error: unknown, errorType: ErrorType): Promise<void> {
  try {
    const config = parseCrashReportConfig();
    if (!config.localEnabled && !config.remoteEnabled) return;

    const packageJson = await readPackageJson();
    const sdkVersion = packageJson.version ?? "unknown";

    const report = buildCrashReport({ error, sdkVersion, errorType });

    if (config.localEnabled) {
      const filePath = writeCrashReport(report, config.localDir);
      if (filePath) {
        logger.log(
          [
            "",
            "An unexpected error occurred. A crash report has been saved to:",
            `  ${filePath}`,
            "",
            "To submit this report:",
            `  tailor-sdk crashreport send --file "${filePath}"`,
          ].join("\n"),
        );
      }
    }

    if (config.remoteEnabled) {
      const ua = userAgentFromVersion(sdkVersion);
      await sendCrashReport(report, ua);
    }
  } catch {
    // Never throw from crash reporting
  }
}

/**
 * Register global uncaughtException and unhandledRejection handlers.
 * These catch errors outside the normal cleanup flow (e.g., during
 * argument parsing). Should be called once at CLI startup before runMain.
 */
export function initCrashReporting(): void {
  const config = parseCrashReportConfig();
  if (!config.localEnabled && !config.remoteEnabled) return;

  const handleFatal = (error: unknown, errorType: ErrorType) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    void reportCrash(error, errorType).finally(() => {
      process.exit(1);
    });
  };

  process.on("uncaughtException", (error) => handleFatal(error, "uncaughtException"));
  process.on("unhandledRejection", (reason) => handleFatal(reason, "unhandledRejection"));
}

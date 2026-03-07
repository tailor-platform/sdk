import { logger } from "@/cli/shared/logger";
import { readPackageJson } from "@/cli/shared/package-json";
import { parseCrashReportConfig } from "./config";
import { buildCrashReport, type CrashType } from "./report";
import { sendCrashReport } from "./sender";
import { writeCrashReport } from "./writer";

/**
 * Report an unexpected crash. Writes a local crash log file and optionally
 * sends the report to a remote endpoint. Displays a user-facing message
 * with the crash log path and a command to submit the report.
 *
 * Never throws - all errors are silently caught.
 * @param error - The error that caused the crash
 * @param crashType - How the error was caught
 */
export async function reportCrash(error: unknown, crashType: CrashType): Promise<void> {
  try {
    const config = parseCrashReportConfig();
    if (!config.localEnabled && !config.remoteEnabled) return;

    const packageJson = await readPackageJson();
    const sdkVersion = packageJson.version ?? "unknown";

    const report = buildCrashReport({ error, sdkVersion, crashType });

    if (config.localEnabled) {
      const filePath = writeCrashReport(report, config.localDir);
      // Only show banner for truly unexpected crashes, not routine handled errors
      if (filePath && crashType !== "handledError") {
        logger.log("");
        logger.log("An unexpected error occurred. A crash report has been saved to:");
        logger.log(`  ${filePath}`);
        logger.log("");
        logger.log("To submit this report:");
        logger.log(`  tailor-sdk crash-report send ${filePath}`);
      }
    }

    if (config.remoteEnabled) {
      const { userAgent } = await import("@/cli/shared/client");
      const ua = await userAgent();
      await sendCrashReport(report, ua);
    }
  } catch {
    // Never throw from crash reporting
  }
}

/**
 * Register global uncaughtException and unhandledRejection handlers.
 * These catch errors outside the normal withCommonArgs flow (e.g., during
 * argument parsing). Should be called once at CLI startup before runMain.
 */
export function initCrashReporting(): void {
  const config = parseCrashReportConfig();
  if (!config.localEnabled && !config.remoteEnabled) return;

  const handleFatal = (error: unknown, crashType: CrashType) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    void reportCrash(error, crashType).finally(() => {
      process.exit(1);
    });
  };

  process.on("uncaughtException", (error) => handleFatal(error, "uncaughtException"));
  process.on("unhandledRejection", (reason) => handleFatal(reason, "unhandledRejection"));
}

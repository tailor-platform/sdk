import * as path from "pathe";
import { isCI } from "std-env";
import { xdgConfig } from "xdg-basedir";

export interface CrashReportConfig {
  readonly localEnabled: boolean;
  readonly remoteEnabled: boolean;
  readonly localDir: string;
}

/**
 * Parse crash report configuration from environment variables.
 * Local crash log writing is enabled by default (opt-out via TAILOR_CRASH_REPORTS_LOCAL=off).
 * Remote sending is disabled by default (opt-in via TAILOR_CRASH_REPORTS_REMOTE=on).
 * Both are auto-disabled in CI environments.
 * @returns Crash report configuration
 */
export function parseCrashReportConfig(): CrashReportConfig {
  if (isCI) {
    return {
      localEnabled: false,
      remoteEnabled: false,
      localDir: "",
    };
  }

  const localEnabled = (process.env.TAILOR_CRASH_REPORTS_LOCAL ?? "on").toLowerCase() !== "off";
  const remoteEnabled = (process.env.TAILOR_CRASH_REPORTS_REMOTE ?? "off").toLowerCase() === "on";
  const localDir = xdgConfig ? path.join(xdgConfig, "tailor-platform", "crash-reports") : "";

  return {
    localEnabled: localEnabled && localDir !== "",
    remoteEnabled,
    localDir,
  };
}

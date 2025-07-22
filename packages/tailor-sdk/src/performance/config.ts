import type { PerformanceConfig } from "./types";

function getPerformanceConfig(): PerformanceConfig {
  const envLogLevel = process.env.TAILOR_PERFORMANCE_LOG_LEVEL;

  // "summary"または"detailed"の場合
  if (envLogLevel === "summary" || envLogLevel === "detailed") {
    return {
      enabled: true,
      logLevel: envLogLevel,
      thresholdMs: process.env.TAILOR_PERFORMANCE_THRESHOLD_MS
        ? parseInt(process.env.TAILOR_PERFORMANCE_THRESHOLD_MS, 10)
        : undefined,
    };
  }

  if (envLogLevel) {
    console.warn(
      `[Performance] Invalid TAILOR_PERFORMANCE_LOG_LEVEL value: "${envLogLevel}". Valid values are "summary" or "detailed". Performance tracking disabled.`,
    );
  }
  return {
    enabled: false,
    logLevel: undefined,
    thresholdMs: undefined,
  };
}

export const performanceConfig = {
  get enabled() {
    return getPerformanceConfig().enabled;
  },
  get logLevel() {
    return getPerformanceConfig().logLevel;
  },
  get thresholdMs() {
    return getPerformanceConfig().thresholdMs;
  },
};

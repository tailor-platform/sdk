export { measure } from "./decorators";
export { PerformanceTracker, performanceTracker } from "./tracker";
export { BaseReporter, ConsoleReporter, JSONReporter } from "./reporters/index";
export type { Reporter } from "./reporters/index";

import { performanceTracker } from "./tracker";

export {
  getPerformanceConfig,
  isPerformanceTrackingEnabled,
  performanceConfig,
} from "./config";

export type {
  MethodDecoratorContext,
  PerformanceConfig,
  PerformanceMeasurement,
  PerformanceStats,
} from "./types";

export function getPerformanceSummary(): string {
  const stats = performanceTracker.getAllStats();

  if (stats.length === 0) {
    return "No performance data collected";
  }

  const summary = stats
    .sort((a, b) => b.averageTime - a.averageTime)
    .map((stat) =>
      `${stat.className}.${stat.methodName}: ` +
      `calls=${stat.callCount}, ` +
      `avg=${stat.averageTime.toFixed(2)}ms, ` +
      `min=${stat.minTime.toFixed(2)}ms, ` +
      `max=${stat.maxTime.toFixed(2)}ms`
    )
    .join("\n");

  return `Performance Summary:\n${summary}`;
}

export function clearPerformanceData(): void {
  performanceTracker.clear();
}

export function exportPerformanceData(): string {
  const stats = performanceTracker.getAllStats();
  return JSON.stringify(stats, null, 2);
}

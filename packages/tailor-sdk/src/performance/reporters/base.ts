import type { PerformanceStats } from "../types.ts";

export interface Reporter {
  report(stats: PerformanceStats[]): void | Promise<void>;
}

export abstract class BaseReporter implements Reporter {
  protected sortByTotalTime(stats: PerformanceStats[]): PerformanceStats[] {
    return [...stats].sort((a, b) => b.totalTime - a.totalTime);
  }

  protected calculateSummary(stats: PerformanceStats[]): {
    totalCalls: number;
    totalTime: number;
    uniqueMethods: number;
  } {
    const totalCalls = stats.reduce((sum, stat) => sum + stat.callCount, 0);
    const totalTime = stats.reduce((sum, stat) => sum + stat.totalTime, 0);
    const uniqueMethods = stats.length;

    return {
      totalCalls,
      totalTime,
      uniqueMethods,
    };
  }

  protected formatTime(ms: number): string {
    if (ms < 1) {
      return `${(ms * 1000).toFixed(2)}μs`;
    } else if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    } else {
      return `${(ms / 1000).toFixed(2)}s`;
    }
  }

  abstract report(stats: PerformanceStats[]): void | Promise<void>;
}

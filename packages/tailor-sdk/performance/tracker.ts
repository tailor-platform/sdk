import type { PerformanceMeasurement, PerformanceStats } from "./types";
import type { Reporter } from "./reporters/index";
import { ConsoleReporter, JSONReporter } from "./reporters/index";
import { performanceConfig } from "./config";
import * as path from "node:path";
import * as fs from "node:fs";
import ml from "multiline-ts";

export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private measurements: Map<string, PerformanceMeasurement[]> = new Map();
  private stats: Map<string, PerformanceStats> = new Map();
  private exitHandlerRegistered = false;

  private constructor() {
    this.setupExitHandler();
  }

  static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  recordMeasurement(measurement: PerformanceMeasurement): void {
    const key = this.getKey(measurement.className, measurement.methodName);

    if (!this.measurements.has(key)) {
      this.measurements.set(key, []);
    }
    this.measurements.get(key)!.push(measurement);

    this.updateStats(key, measurement);
  }

  getStats(
    className: string,
    methodName: string,
  ): PerformanceStats | undefined {
    const key = this.getKey(className, methodName);
    return this.stats.get(key);
  }

  getAllStats(): PerformanceStats[] {
    return Array.from(this.stats.values());
  }

  getMeasurements(
    className: string,
    methodName: string,
  ): PerformanceMeasurement[] {
    const key = this.getKey(className, methodName);
    return this.measurements.get(key) || [];
  }

  clear(): void {
    this.measurements.clear();
    this.stats.clear();
  }

  clearMethod(className: string, methodName: string): void {
    const key = this.getKey(className, methodName);
    this.measurements.delete(key);
    this.stats.delete(key);
  }

  async report(reporter: Reporter): Promise<void> {
    const stats = this.getAllStats();
    await reporter.report(stats);
  }

  reset(): void {
    this.clear();
  }

  private getKey(className: string, methodName: string): string {
    return `${className}.${methodName}`;
  }

  private updateStats(key: string, measurement: PerformanceMeasurement): void {
    const existing = this.stats.get(key);

    if (!existing) {
      this.stats.set(key, {
        className: measurement.className,
        methodName: measurement.methodName,
        callCount: 1,
        totalTime: measurement.executionTime,
        averageTime: measurement.executionTime,
        minTime: measurement.executionTime,
        maxTime: measurement.executionTime,
        lastCalled: measurement.timestamp,
      });
    } else {
      existing.callCount++;
      existing.totalTime += measurement.executionTime;
      existing.averageTime = existing.totalTime / existing.callCount;
      existing.minTime = Math.min(existing.minTime, measurement.executionTime);
      existing.maxTime = Math.max(existing.maxTime, measurement.executionTime);
      existing.lastCalled = measurement.timestamp;
    }
  }

  private setupExitHandler(): void {
    // パフォーマンス計測が無効の場合は何もしない
    if (!performanceConfig.enabled) return;

    if (this.exitHandlerRegistered) return;
    this.exitHandlerRegistered = true;

    const handleExit = async () => {
      try {
        const reportType = process.env.TAILOR_PERFORMANCE_REPORT_TYPE ||
          "console";
        let reporter: Reporter;

        switch (reportType) {
          case "json":
            const reportPath = process.env.TAILOR_PERFORMANCE_REPORT_PATH ||
              "./performance-reports";
            fs.mkdirSync(reportPath, { recursive: true });

            const timestamp = new Date().toISOString().replace(
              /^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+).*/g,
              "$1$2$3$4$5$6",
            );
            const filename = `report-${timestamp}.json`;
            const outputPath = path.join(reportPath, filename);

            reporter = new JSONReporter(outputPath);
            break;
          case "console":
          default:
            reporter = new ConsoleReporter();
            break;
        }

        await this.report(reporter);

        const stats = this.getAllStats();
        if (stats.length > 0) {
          const totalCalls = stats.reduce((sum, s) => sum + s.callCount, 0);

          console.log(ml`
            === Performance Summary ===
            Total unique methods measured: ${stats.length.toString()}
            Total method calls: ${totalCalls.toString()}
          `);
        }
      } catch (error) {
        console.error("Failed to generate performance report on exit:", error);
      }
    };

    process.on("exit", handleExit);
    process.on("SIGINT", () => {
      handleExit().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      handleExit().then(() => process.exit(0));
    });
  }
}

export const performanceTracker = PerformanceTracker.getInstance();

import { writeFileSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { BaseReporter } from "./base";
import type { PerformanceStats } from "../types";

export class JSONReporter extends BaseReporter {
  private outputPath: string;

  constructor(outputPath: string = "./performance-report.json") {
    super();
    this.outputPath = outputPath;
  }

  report(stats: PerformanceStats[]): void {
    const sortedStats = this.sortByTotalTime(stats);
    const summary = this.calculateSummary(stats);

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalCalls: summary.totalCalls,
        totalTime: summary.totalTime,
        uniqueMethods: summary.uniqueMethods,
      },
      details: sortedStats.map((stat) => ({
        className: stat.className,
        methodName: stat.methodName,
        callCount: stat.callCount,
        totalTime: stat.totalTime,
        averageTime: stat.averageTime,
        minTime: stat.minTime,
        maxTime: stat.maxTime,
      })),
    };

    const dir = dirname(this.outputPath);
    mkdirSync(dir, { recursive: true });

    writeFileSync(this.outputPath, JSON.stringify(report, null, 2));

    console.log(`\n📄 Performance report saved to: ${this.outputPath}`);
  }
}

import { BaseReporter } from "./base";
import type { PerformanceStats } from "../types";

export class ConsoleReporter extends BaseReporter {
  report(stats: PerformanceStats[]): void {
    if (stats.length === 0) {
      console.log("\n📊 Performance Report: No data collected");
      return;
    }

    const sortedStats = this.sortByTotalTime(stats);
    const summary = this.calculateSummary(stats);

    console.log("\n" + "=".repeat(80));
    console.log("📊 Performance Report");
    console.log("=".repeat(80));

    console.log("\n📈 Summary:");
    console.log(`  • Total Calls: ${summary.totalCalls}`);
    console.log(`  • Total Time: ${this.formatTime(summary.totalTime)}`);
    console.log(`  • Unique Methods: ${summary.uniqueMethods}`);

    console.log("\n📋 Method Statistics (sorted by total time):");
    console.log("-".repeat(80));
    console.log(
      this.formatHeader("Method", "Calls", "Total", "Average", "Min", "Max"),
    );
    console.log("-".repeat(80));

    sortedStats.forEach((stat) => {
      const methodName = `${stat.className}.${stat.methodName}`;
      console.log(
        this.formatRow(
          methodName,
          stat.callCount.toString(),
          this.formatTime(stat.totalTime),
          this.formatTime(stat.averageTime),
          this.formatTime(stat.minTime),
          this.formatTime(stat.maxTime),
        ),
      );
    });

    console.log("=".repeat(80));
    console.log(`Generated at: ${new Date().toISOString()}`);
    console.log("=".repeat(80) + "\n");
  }

  private formatHeader(...columns: string[]): string {
    const widths = [35, 8, 12, 12, 12, 12];
    return columns.map((col, i) => col.padEnd(widths[i])).join(" ");
  }

  private formatRow(...columns: string[]): string {
    const widths = [35, 8, 12, 12, 12, 12];
    return columns
      .map((col, i) => {
        if (i === 0 && col.length > widths[i]) {
          return "..." + col.slice(-(widths[i] - 3));
        }
        return col.padEnd(widths[i]);
      })
      .join(" ");
  }
}

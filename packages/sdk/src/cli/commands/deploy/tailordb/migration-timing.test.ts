import { describe, expect, test, vi } from "vitest";
import {
  formatDuration,
  formatMaintenanceSummary,
  MaintenanceTimeline,
  ScriptRunTimer,
} from "./migration-timing";

vi.mock("#/cli/shared/logger", () => ({
  logger: { debug: vi.fn() },
}));

describe("formatDuration", () => {
  test.each([
    [0, "0.0s"],
    [420, "0.4s"],
    [9_949, "9.9s"],
    [12_400, "12s"],
    [59_600, "1m00s"],
    [1_010_000, "16m50s"],
    [3_723_000, "1h02m03s"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("MaintenanceTimeline", () => {
  test("splits the window into phases that add up to its length", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("restrict", 0);
    timeline.enter("preMigration", 1_000);
    const run = new ScriptRunTimer("tailordb", 1, 3_000);
    run.waiting(5_000);
    run.running(905_000);
    run.finished(1_006_000, true);
    timeline.recordScript(run, 1_007_000);
    timeline.enter("postMigration", 1_007_000);
    timeline.enter("restore", 1_009_000);
    timeline.finish(1_010_000);

    const report = timeline.report(["tailordb"]);

    expect(report).toEqual({
      namespaces: ["tailordb"],
      maintenanceMs: 1_010_000,
      phases: {
        restrict: 1_000,
        preMigration: 2_000,
        jobSetup: 2_000,
        waitingToStart: 900_000,
        running: 101_000,
        waitingOrRunning: 0,
        jobCleanup: 1_000,
        postMigration: 2_000,
        restore: 1_000,
      },
      migrations: [
        {
          namespace: "tailordb",
          migrationNumber: 1,
          startObserved: true,
          waitingToStartMs: 900_000,
          runningMs: 101_000,
          waitingOrRunningMs: 0,
        },
      ],
    });
  });

  test("adds up a phase that recurs across migrations", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("restrict", 0);
    timeline.enter("preMigration", 10);
    timeline.enter("postMigration", 20);
    timeline.enter("preMigration", 40);
    timeline.enter("postMigration", 70);
    timeline.enter("restore", 110);
    timeline.finish(160);

    const report = timeline.report(["a", "b"]);

    expect(report.phases).toMatchObject({ preMigration: 40, postMigration: 60 });
    expect(report.maintenanceMs).toBe(160);
    expect(report.migrations).toEqual([]);
  });

  test("keeps the total equal to the sum of the phases after rounding", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("restrict", 0.4);
    timeline.enter("preMigration", 1.8);
    timeline.enter("postMigration", 3.3);
    timeline.enter("restore", 4.9);
    timeline.finish(6.2);

    const report = timeline.report(["tailordb"]);

    const sum = Object.values(report.phases).reduce((total, ms) => total + ms, 0);
    expect(report.maintenanceMs).toBe(sum);
  });
});

describe("ScriptRunTimer", () => {
  test("adds up every wait for a job to start and every stretch of running", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("preMigration", 0);
    const run = new ScriptRunTimer("tailordb", 2, 0);
    run.waiting(10);
    run.running(40);
    run.waiting(50);
    run.running(90);
    run.finished(100, true);
    timeline.recordScript(run, 105);
    timeline.finish(105);

    const report = timeline.report(["tailordb"]);

    expect(report.phases).toMatchObject({ waitingToStart: 70, running: 20, jobCleanup: 5 });
    expect(report.migrations).toEqual([
      {
        namespace: "tailordb",
        migrationNumber: 2,
        startObserved: true,
        waitingToStartMs: 70,
        runningMs: 20,
        waitingOrRunningMs: 0,
      },
    ]);
  });

  test("does not split the run when its script was never seen starting", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("preMigration", 0);
    const run = new ScriptRunTimer("tailordb", 1, 0);
    run.waiting(10);
    run.finished(70, false);
    timeline.recordScript(run, 75);
    timeline.finish(75);

    const report = timeline.report(["tailordb"]);

    expect(report.phases).toMatchObject({ waitingToStart: 0, running: 0, waitingOrRunning: 60 });
    expect(report.migrations).toEqual([
      {
        namespace: "tailordb",
        migrationNumber: 1,
        startObserved: false,
        waitingToStartMs: 0,
        runningMs: 0,
        waitingOrRunningMs: 60,
      },
    ]);
  });

  test("splits only the runs whose script was seen running", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("preMigration", 0);
    const run = new ScriptRunTimer("tailordb", 1, 0);
    run.waiting(10);
    run.finished(40, false);
    run.waiting(50);
    run.running(60);
    run.waiting(80);
    run.finished(90, true);
    timeline.recordScript(run, 95);
    timeline.finish(95);

    const report = timeline.report(["tailordb"]);

    expect(report.phases).toMatchObject({
      waitingOrRunning: 30,
      waitingToStart: 20,
      running: 20,
      jobCleanup: 15,
    });
    expect(report.migrations).toEqual([
      expect.objectContaining({
        startObserved: true,
        waitingToStartMs: 20,
        runningMs: 20,
        waitingOrRunningMs: 30,
      }),
    ]);
    expect(run.waitedMs).toBe(20);
  });

  test("counts a run whose start was only seen once it finished as having run", () => {
    const run = new ScriptRunTimer("tailordb", 1, 0);
    run.waiting(10);
    run.running(20);
    run.finished(30, true);
    run.waiting(40);
    run.finished(70, true);

    expect(run.marks().map((mark) => mark.phase)).toEqual([
      "jobSetup",
      "waitingToStart",
      "running",
      "jobCleanup",
      "waitingToStart",
      "running",
      "jobCleanup",
    ]);
  });

  test("reports a stretch it could not observe as waiting to start or running", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("preMigration", 0);
    const run = new ScriptRunTimer("tailordb", 1, 0);
    run.waiting(10);
    run.running(20);
    run.waiting(30);
    run.unknown(40);
    run.finished(100, true);
    timeline.recordScript(run, 100);
    timeline.finish(100);

    const report = timeline.report(["tailordb"]);

    expect(report.phases).toMatchObject({ waitingToStart: 20, running: 10, waitingOrRunning: 60 });
    expect(report.migrations).toEqual([
      expect.objectContaining({
        startObserved: true,
        waitingToStartMs: 20,
        runningMs: 10,
        waitingOrRunningMs: 60,
      }),
    ]);
  });

  test("ignores a repeated report of the current phase", () => {
    const run = new ScriptRunTimer("tailordb", 1, 0);
    run.waiting(10);
    run.waiting(20);
    run.running(30);
    run.running(40);

    expect(run.phase).toBe("running");
    expect(run.phaseStartedAt).toBe(30);
    expect(run.waitedMs).toBe(20);
  });
});

describe("formatMaintenanceSummary", () => {
  test("names the namespaces and every phase that took place", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("restrict", 0);
    timeline.enter("preMigration", 1_200);
    const run = new ScriptRunTimer("tailordb", 1, 4_600);
    run.waiting(6_700);
    run.running(908_700);
    run.finished(1_009_700, true);
    timeline.recordScript(run, 1_010_500);
    timeline.enter("postMigration", 1_010_500);
    timeline.enter("restore", 1_014_500);
    timeline.finish(1_015_600);

    expect(formatMaintenanceSummary(timeline.report(["tailordb"]))).toBe(
      "Tables of namespace tailordb were in maintenance mode for 16m56s " +
        "(restrict 1.2s, pre-migration 3.4s, job setup 2.1s, waiting to start 15m02s, " +
        "running 1m41s, job cleanup 0.8s, post-migration 4.0s, restore 1.1s).",
    );
  });

  test("lists several namespaces and leaves out phases that never happened", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("restrict", 0);
    timeline.enter("preMigration", 1_000);
    timeline.enter("postMigration", 2_000);
    timeline.enter("restore", 3_000);
    timeline.finish(4_000);

    expect(formatMaintenanceSummary(timeline.report(["a", "b"]))).toBe(
      "Tables of namespaces a, b were in maintenance mode for 4.0s " +
        "(restrict 1.0s, pre-migration 1.0s, post-migration 1.0s, restore 1.0s).",
    );
  });

  test("leaves out the breakdown when no phase took a whole millisecond", () => {
    const timeline = new MaintenanceTimeline();
    timeline.enter("restrict", 0);
    timeline.enter("restore", 0.2);
    timeline.finish(0.4);

    expect(formatMaintenanceSummary(timeline.report(["tailordb"]))).toBe(
      "Tables of namespace tailordb were in maintenance mode for 0.0s.",
    );
  });
});

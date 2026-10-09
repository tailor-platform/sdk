import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";

const PHASE_LABELS = {
  restrict: "restrict",
  preMigration: "pre-migration",
  jobSetup: "job setup",
  waitingToStart: "waiting to start",
  running: "running",
  waitingOrRunning: "waiting to start or running",
  jobCleanup: "job cleanup",
  postMigration: "post-migration",
  restore: "restore",
} as const;

/** A stretch of the time a migration keeps tables in maintenance mode. */
export type MaintenancePhase = keyof typeof PHASE_LABELS;

const MAINTENANCE_PHASES = Object.keys(PHASE_LABELS) as MaintenancePhase[];

type ScriptRunPhase = "jobSetup" | "waitingToStart" | "running" | "jobCleanup";

interface Mark<Phase extends MaintenancePhase = MaintenancePhase> {
  phase: Phase;
  at: number;
}

/** How long one migration script waited for its jobs to start and how long it ran. */
export interface MigrationScriptTiming {
  namespace: string;
  migrationNumber: number;
  /** Whether the script was seen running; when it was not, the split between waiting and running is unknown. */
  startObserved: boolean;
  waitingToStartMs: number | null;
  runningMs: number | null;
}

/** How long a deploy kept tables in maintenance mode while applying migrations, by phase. */
export interface MaintenanceReport {
  namespaces: string[];
  /** Length of the window, equal to the sum of `phases`. */
  maintenanceMs: number;
  phases: Record<MaintenancePhase, number>;
  /** One entry per migration script that ran. */
  migrations: MigrationScriptTiming[];
}

/**
 * Format a duration for progress and summary lines.
 * @param ms - Duration in milliseconds
 * @returns Duration such as `0.4s`, `12s`, `16m50s`, or `1h02m03s`
 */
export function formatDuration(ms: number): string {
  if (ms < 9_950) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}h${pad(minutes)}m${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m${pad(seconds)}s`;
  return `${seconds}s`;
}

function sumDurations(marks: readonly Mark[], end: number): Map<MaintenancePhase, number> {
  const durations = new Map<MaintenancePhase, number>();
  marks.forEach((mark, index) => {
    const until = marks[index + 1]?.at ?? end;
    durations.set(mark.phase, (durations.get(mark.phase) ?? 0) + (until - mark.at));
  });
  return durations;
}

/**
 * Times one migration script run on the deploy's clock: preparing its job, waiting for a job to
 * start, running, and cleaning up after it finished.
 */
export class ScriptRunTimer {
  readonly namespace: string;
  readonly migrationNumber: number;
  readonly #marks: Mark<ScriptRunPhase>[];

  /**
   * @param namespace - Namespace of the migration
   * @param migrationNumber - Number of the migration
   * @param at - When preparing the job started
   */
  constructor(namespace: string, migrationNumber: number, at = performance.now()) {
    this.namespace = namespace;
    this.migrationNumber = migrationNumber;
    this.#marks = [{ phase: "jobSetup", at }];
  }

  get phase(): ScriptRunPhase {
    return this.#current.phase;
  }

  get phaseStartedAt(): number {
    return this.#current.at;
  }

  /** @returns Time spent waiting for jobs to start, up to the current phase */
  get waitedMs(): number {
    return this.#closedMs("waitingToStart");
  }

  /** @returns Time spent running the script, up to the current phase */
  get ranMs(): number {
    return this.#closedMs("running");
  }

  get startObserved(): boolean {
    return this.#marks.some((mark) => mark.phase === "running");
  }

  get #current(): Mark<ScriptRunPhase> {
    return assertDefined(this.#marks.at(-1), "A script run always has a phase.");
  }

  /** @param at - When no job of the run was seen running the script any more */
  waiting(at = performance.now()): void {
    this.#enter("waitingToStart", at);
  }

  /** @param at - When a job of the run was seen running the script */
  running(at = performance.now()): void {
    this.#enter("running", at);
  }

  /** @param at - When the run reached a terminal state */
  finished(at = performance.now()): void {
    this.#enter("jobCleanup", at);
  }

  /**
   * The run's phases, with waiting relabeled when the script was never seen running.
   * @returns Marks in time order
   */
  marks(): Mark[] {
    if (this.startObserved) return [...this.#marks];
    return this.#marks.map((mark) =>
      mark.phase === "waitingToStart" ? { ...mark, phase: "waitingOrRunning" } : mark,
    );
  }

  #closedMs(phase: ScriptRunPhase): number {
    return sumDurations(this.#marks.slice(0, -1), this.#current.at).get(phase) ?? 0;
  }

  #enter(phase: ScriptRunPhase, at: number): void {
    if (this.phase !== phase) this.#marks.push({ phase, at });
  }
}

/**
 * Splits a maintenance window into phases. Every instant between the first `enter` and `finish`
 * belongs to exactly one phase, so the phases add up to the window.
 */
export class MaintenanceTimeline {
  readonly #marks: Mark[] = [];
  readonly #scripts: MigrationScriptTiming[] = [];
  #end: number | undefined;

  /**
   * Start a phase, ending the current one.
   * @param phase - Phase to start
   * @param at - When it started
   */
  enter(phase: MaintenancePhase, at = performance.now()): void {
    this.#logPrevious(at);
    this.#marks.push({ phase, at });
  }

  /**
   * Add a finished script run's phases, ending the current phase where the run began.
   * @param run - The run's timer
   * @param at - When the run's cleanup ended
   */
  recordScript(run: ScriptRunTimer, at = performance.now()): void {
    const marks = run.marks();
    for (const mark of marks) this.enter(mark.phase, mark.at);
    const durations = sumDurations(marks, at);
    const observed = run.startObserved;
    this.#scripts.push({
      namespace: run.namespace,
      migrationNumber: run.migrationNumber,
      startObserved: observed,
      waitingToStartMs: observed ? Math.round(durations.get("waitingToStart") ?? 0) : null,
      runningMs: observed ? Math.round(durations.get("running") ?? 0) : null,
    });
  }

  /** @param at - When the window ended */
  finish(at = performance.now()): void {
    this.#logPrevious(at);
    this.#end = at;
  }

  /**
   * @param namespaces - Namespaces whose tables the window covered
   * @returns Durations by phase, rounded to milliseconds so they add up to the total
   */
  report(namespaces: readonly string[]): MaintenanceReport {
    const end = this.#end ?? performance.now();
    const durations = sumDurations(this.#marks, end);
    const phases = Object.fromEntries(
      MAINTENANCE_PHASES.map((phase) => [phase, Math.round(durations.get(phase) ?? 0)]),
    ) as Record<MaintenancePhase, number>;
    return {
      namespaces: [...namespaces],
      maintenanceMs: Object.values(phases).reduce((total, ms) => total + ms, 0),
      phases,
      migrations: [...this.#scripts],
    };
  }

  #logPrevious(at: number): void {
    const previous = this.#marks.at(-1);
    if (!previous) return;
    logger.debug(
      `Maintenance phase "${PHASE_LABELS[previous.phase]}" took ${formatDuration(at - previous.at)}.`,
    );
  }
}

/**
 * Describe how long a deploy kept tables in maintenance mode.
 * @param report - The window's report
 * @returns One summary line listing every phase with recorded time
 */
export function formatMaintenanceSummary(report: MaintenanceReport): string {
  const subject =
    report.namespaces.length === 1
      ? `namespace ${report.namespaces[0]}`
      : `namespaces ${report.namespaces.join(", ")}`;
  const breakdown = MAINTENANCE_PHASES.filter((phase) => report.phases[phase] > 0)
    .map((phase) => `${PHASE_LABELS[phase]} ${formatDuration(report.phases[phase])}`)
    .join(", ");
  return `Tables of ${subject} were in maintenance mode for ${formatDuration(report.maintenanceMs)} (${breakdown}).`;
}

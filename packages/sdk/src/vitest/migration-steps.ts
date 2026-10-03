/**
 * Run a multi-step migration script's `steps` in tests the way `tailor deploy`
 * does: in dependency order, each step in its own transaction.
 */

import { assertDefined } from "#/utils/assert";
import { orderMigrationSteps } from "#/utils/migration-steps";

/** A step as declared in a migration script's `steps`. */
export interface RunnableMigrationStep<Trx, Context> {
  /** Steps that must complete before this one starts. */
  readonly dependsOn?: readonly string[];
  /** The step body; it receives its own transaction. */
  run: (trx: Trx, context: Context) => Promise<unknown>;
}

export interface RunMigrationStepsOptions<Trx, Context extends { env: unknown }> {
  /**
   * Run one step inside a transaction, e.g.
   * `(run) => db.transaction().execute(run)` for a PGlite-backed Kysely, or
   * `(run) => mock.withTx(run)` for `createKyselyMock`.
   */
  transaction: (run: (trx: Trx) => Promise<unknown>) => Promise<unknown>;
  /** Values passed as `env` to every step; defaults to `{}`. */
  env?: Context["env"];
}

/** Thrown by {@link runMigrationSteps} when a step fails. */
export class MigrationStepError extends Error {
  /** The step that failed. */
  readonly step: string;
  /** Steps that committed before the failure, in execution order. */
  readonly completedSteps: string[];

  constructor(step: string, completedSteps: string[], cause: unknown) {
    super(
      `Migration step "${step}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "MigrationStepError";
    this.step = step;
    this.completedSteps = completedSteps;
  }
}

/**
 * Run a migration script's `steps` in the order `tailor deploy` runs them,
 * committing each step separately, so a test can observe what a failure in a
 * later step leaves behind.
 * @param steps - The script's exported `steps`
 * @param options - Transaction runner and env
 * @returns Names of the steps that ran, in execution order
 * @throws {MigrationStepError} When a step fails; earlier steps stay committed
 */
export async function runMigrationSteps<Trx, Context extends { env: unknown }>(
  steps: Readonly<Record<string, RunnableMigrationStep<Trx, Context>>>,
  options: RunMigrationStepsOptions<Trx, Context>,
): Promise<string[]> {
  const order = orderMigrationSteps(
    Object.entries(steps).map(([name, step]) => ({ name, dependsOn: step.dependsOn ?? [] })),
  );
  const completed: string[] = [];
  for (const name of order) {
    const step = assertDefined(steps[name], `Migration step "${name}" is not defined.`);
    const context = { env: structuredClone(options.env ?? {}) } as Context;
    try {
      await options.transaction((trx) => step.run(trx, context));
    } catch (error) {
      throw new MigrationStepError(name, [...completed], error);
    }
    completed.push(name);
  }
  return completed;
}

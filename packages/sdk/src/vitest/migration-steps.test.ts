import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MigrationStepError, runMigrationSteps } from "./migration-steps";
import { createKyselyPGlite } from "./pglite-kysely";
import type { Transaction } from "kysely";

interface Database {
  Log: { id: number; message: string };
}

type Trx = Transaction<Database>;
type Context = { env: Record<string, string | number | boolean> };

describe("runMigrationSteps", () => {
  const pglite = new PGlite();
  const db = createKyselyPGlite<Database>(pglite);

  beforeAll(async () => {
    await pglite.exec('CREATE TABLE "Log" (id integer PRIMARY KEY, message text NOT NULL);');
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
  });

  const insert = (id: number, message: string) => async (trx: Trx) => {
    await trx.insertInto("Log").values({ id, message }).execute();
  };

  async function messages(): Promise<string[]> {
    const rows = await db.selectFrom("Log").select("message").orderBy("id").execute();
    return rows.map((row) => row.message);
  }

  test("runs every step after its dependencies, each in its own transaction", async () => {
    await db.deleteFrom("Log").execute();
    const transactions: string[] = [];

    const completed = await runMigrationSteps(
      {
        recompute: { dependsOn: ["backfill"], run: insert(2, "recompute") },
        backfill: { run: insert(1, "backfill") },
      },
      {
        transaction: async (run) => {
          transactions.push("begin");
          await db.transaction().execute(run);
        },
      },
    );

    expect(completed).toEqual(["backfill", "recompute"]);
    expect(transactions).toEqual(["begin", "begin"]);
    expect(await messages()).toEqual(["backfill", "recompute"]);
  });

  test("keeps the steps that committed before one fails", async () => {
    await db.deleteFrom("Log").execute();

    const run = runMigrationSteps(
      {
        backfill: { run: insert(1, "backfill") },
        recompute: {
          dependsOn: ["backfill"],
          run: async (trx: Trx) => {
            await insert(2, "partial")(trx);
            throw new Error("recompute failed");
          },
        },
        cleanup: { dependsOn: ["recompute"], run: insert(3, "cleanup") },
      },
      { transaction: (step) => db.transaction().execute(step) },
    );

    const error = await run.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationStepError);
    expect(error).toMatchObject({
      step: "recompute",
      completedSteps: ["backfill"],
      message: expect.stringContaining("recompute failed"),
    });
    expect(await messages()).toEqual(["backfill"]);
  });

  test("accepts a step that returns its query result", async () => {
    await db.deleteFrom("Log").execute();

    await runMigrationSteps(
      {
        backfill: {
          run: (trx: Trx) => trx.insertInto("Log").values({ id: 1, message: "result" }).execute(),
        },
      },
      { transaction: (step) => db.transaction().execute(step) },
    );

    expect(await messages()).toEqual(["result"]);
  });

  test("passes env to every step", async () => {
    const seen: Context["env"][] = [];

    await runMigrationSteps(
      {
        first: { run: async (_trx: Trx, { env }: Context) => void seen.push(env) },
        second: { run: async (_trx: Trx, { env }: Context) => void seen.push(env) },
      },
      { transaction: (step) => db.transaction().execute(step), env: { STAGE: "test" } },
    );

    expect(seen).toEqual([{ STAGE: "test" }, { STAGE: "test" }]);
  });

  test("gives every step its own context, as separate deploy jobs do", async () => {
    const seen: unknown[] = [];

    await runMigrationSteps(
      {
        first: {
          run: async (_trx: Trx, context: Context) => {
            context.env.LEAKED = true;
          },
        },
        second: {
          dependsOn: ["first"],
          run: async (_trx: Trx, { env }: Context) => void seen.push(env),
        },
      },
      { transaction: (step) => db.transaction().execute(step), env: { STAGE: "test" } },
    );

    expect(seen).toEqual([{ STAGE: "test" }]);
  });

  test("rejects a step graph the deploy would reject", async () => {
    await expect(
      runMigrationSteps(
        { recompute: { dependsOn: ["backfill"], run: insert(1, "recompute") } },
        { transaction: (step) => db.transaction().execute(step) },
      ),
    ).rejects.toThrow('Step "recompute" depends on undefined step "backfill"');
  });
});

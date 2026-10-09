import { describe, expect, test } from "vitest";
import ml from "#/utils/multiline";
import { analyzeMigrationScriptSource } from "./script-form";

const analyze = (source: string) => analyzeMigrationScriptSource(source, "0003/migrate.ts");

describe("analyzeMigrationScriptSource", () => {
  test.each([
    ["an async function declaration", "export async function main(trx) {}"],
    ["a const arrow function", "export const main = async (trx) => {};"],
    ["an export specifier", "async function run(trx) {}\nexport { run as main };"],
    ["a destructured declaration", "export const { main } = createMigration();"],
  ])("detects the single-transaction form exported as %s", (_label, source) => {
    expect(analyze(source)).toEqual({ kind: "main" });
  });

  test("treats a re-export of another module as the single-transaction form", () => {
    expect(analyze('export * from "./impl";')).toEqual({ kind: "main" });
  });

  test("keeps running main when steps sits next to a re-export that may export it", () => {
    expect(
      analyze(ml`
        export * from "./legacy";
        export const steps = { backfill: { run: async (trx) => {} } };
      `),
    ).toEqual({ kind: "main", ignoredSteps: true });
  });

  test("ignores type-only exports when telling main from steps", () => {
    const form = analyze(ml`
      export type * from "./db";
      export type { Transaction as steps } from "./db";
      export const steps = { backfill: { run: async (trx) => {} } };
    `);
    expect(form).toMatchObject({ kind: "steps", order: ["backfill"] });
    expect(
      analyze(ml`
        export type { Transaction as steps } from "./db";
        export async function main(trx) {}
      `),
    ).toEqual({ kind: "main" });
  });

  test("reads steps and their dependencies in declaration order", () => {
    const form = analyze(ml`
      import type { MigrationSteps } from "./db";

      export const steps = {
        recomputeTotals: {
          dependsOn: ["backfillInvoice"],
          run: async (trx) => {},
        },
        backfillInvoice: { run: async (trx, { env }) => {} },
        "backfillUser": {
          async run(trx) {},
        },
      } satisfies MigrationSteps;
    `);

    expect(form).toEqual({
      kind: "steps",
      order: ["backfillInvoice", "recomputeTotals", "backfillUser"],
    });
  });

  test("accepts run as a reference and dependsOn as a const tuple", () => {
    const form = analyze(ml`
      async function backfill(trx) {}
      export const steps = {
        backfill: { run: backfill },
        recompute: { dependsOn: ["backfill"] as const, run: backfill },
      } as const;
    `);

    expect(form).toMatchObject({ kind: "steps", order: ["backfill", "recompute"] });
  });

  test("rejects a script that exports neither main nor steps", () => {
    expect(() => analyze("export const other = 1;")).toThrow(
      "Invalid migration script 0003/migrate.ts: it must export either `main` or `steps`",
    );
  });

  test("keeps running main, as before steps existed, when a script exports both", () => {
    expect(
      analyze(ml`
        export async function main(trx) {}
        export const steps = { backfill: { run: async (trx) => {} } };
      `),
    ).toEqual({ kind: "main", ignoredSteps: true });
  });

  test("rejects steps that are not declared as an object literal", () => {
    expect(() =>
      analyze(ml`
        const defined = { backfill: { run: async (trx) => {} } };
        export const steps = defined;
      `),
    ).toThrow("`steps` must be an object literal");
  });

  test("rejects steps exported through a specifier", () => {
    expect(() =>
      analyze(ml`
        const steps = { backfill: { run: async (trx) => {} } };
        export { steps };
      `),
    ).toThrow("declare `steps` directly as `export const steps = { ... }`");
    expect(() => analyze("export const { steps } = defineSteps();")).toThrow(
      "declare `steps` directly as `export const steps = { ... }`",
    );
  });

  test("rejects spread and computed step names", () => {
    expect(() =>
      analyze(ml`
        const shared = {};
        export const steps = { ...shared, backfill: { run: async (trx) => {} } };
      `),
    ).toThrow("`steps` cannot use spread properties");
    expect(() =>
      analyze(ml`
        const name = "backfill";
        export const steps = { [name]: { run: async (trx) => {} } };
      `),
    ).toThrow("step names must be written literally");
  });

  test.each([
    ["contains a comma", "back,fill"],
    ["contains a slash", "back/fill"],
    ["contains a hyphen", "back-fill"],
    ["is empty", ""],
    ["starts with a digit", "1backfill"],
    ["is longer than 64 characters", "a".repeat(65)],
  ])("rejects a step name that %s", (_label, name) => {
    expect(() =>
      analyze(`export const steps = { ${JSON.stringify(name)}: { run: async (trx) => {} } };`),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_SCRIPT_INVALID",
        message: expect.stringContaining(
          "start with a letter and contain only letters, digits, and underscores, up to 64 characters",
        ),
      }),
    );
  });

  test.each(["backfill", "Backfill_2", "a", `a${"b".repeat(63)}`])(
    "accepts the step name %s",
    (name) => {
      expect(
        analyze(`export const steps = { ${name}: { run: async (trx) => {} } };`),
      ).toMatchObject({ kind: "steps", order: [name] });
    },
  );

  test("asks for a step defined elsewhere to be written inside steps", () => {
    expect(() =>
      analyze(ml`
        const backfill = { run: async (trx) => {} };
        export const steps = { backfill };
      `),
    ).toThrow("written inside `steps`");
  });

  test("rejects a step that is a bare function instead of { run }", () => {
    expect(() => analyze("export const steps = { backfill: async (trx) => {} };")).toThrow(
      'Step "backfill" must be an object literal with a `run` function',
    );
  });

  test("rejects a step without run and a step with unknown keys", () => {
    expect(() => analyze("export const steps = { backfill: { dependsOn: [] } };")).toThrow(
      'Step "backfill" is missing `run`',
    );
    expect(() =>
      analyze("export const steps = { backfill: { run: async (trx) => {}, timeout: 10 } };"),
    ).toThrow('Step "backfill" has unknown key "timeout"');
  });

  test("rejects dependsOn that is not a list of string literals", () => {
    expect(() =>
      analyze(ml`
        const deps = ["backfill"];
        export const steps = {
          backfill: { run: async (trx) => {} },
          recompute: { dependsOn: deps, run: async (trx) => {} },
        };
      `),
    ).toThrow('Step "recompute" must list `dependsOn` as an array of string literals');
  });

  test("reports graph problems against the script path", () => {
    expect(() =>
      analyze(
        "export const steps = { recompute: { dependsOn: ['backfill'], run: async () => {} } };",
      ),
    ).toThrow(/0003\/migrate\.ts[\s\S]*depends on undefined step "backfill"/);
  });

  test("reports syntax errors with the script path", () => {
    expect(() => analyze("export const steps = {")).toThrow("Failed to parse 0003/migrate.ts");
  });
});

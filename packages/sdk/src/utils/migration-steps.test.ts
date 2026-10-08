import { describe, expect, test } from "vitest";
import { orderMigrationSteps } from "./migration-steps";

describe("orderMigrationSteps", () => {
  test("keeps declaration order for steps without dependencies", () => {
    expect(
      orderMigrationSteps([
        { name: "backfillUser", dependsOn: [] },
        { name: "backfillInvoice", dependsOn: [] },
      ]),
    ).toEqual(["backfillUser", "backfillInvoice"]);
  });

  test("runs a step after the steps it depends on, even when declared first", () => {
    expect(
      orderMigrationSteps([
        { name: "recomputeTotals", dependsOn: ["backfillInvoice"] },
        { name: "backfillUser", dependsOn: [] },
        { name: "backfillInvoice", dependsOn: [] },
      ]),
    ).toEqual(["backfillUser", "backfillInvoice", "recomputeTotals"]);
  });

  test("orders a diamond so the join runs last", () => {
    expect(
      orderMigrationSteps([
        { name: "join", dependsOn: ["left", "right"] },
        { name: "right", dependsOn: ["root"] },
        { name: "left", dependsOn: ["root"] },
        { name: "root", dependsOn: [] },
      ]),
    ).toEqual(["root", "right", "left", "join"]);
  });

  test("rejects an empty step list", () => {
    expect(() => orderMigrationSteps([])).toThrow("must define at least one step");
  });

  test("rejects names that are not identifiers", () => {
    expect(() => orderMigrationSteps([{ name: "backfill-user", dependsOn: [] }])).toThrow(
      'Step name "backfill-user" is invalid',
    );
  });

  test("rejects names longer than 64 characters", () => {
    const name = `s${"x".repeat(64)}`;
    expect(() => orderMigrationSteps([{ name, dependsOn: [] }])).toThrow(
      `Step name "${name}" is invalid`,
    );
  });

  test("rejects duplicate step names", () => {
    expect(() =>
      orderMigrationSteps([
        { name: "backfillUser", dependsOn: [] },
        { name: "backfillUser", dependsOn: [] },
      ]),
    ).toThrow('Step "backfillUser" is defined more than once');
  });

  test("rejects a dependency on an undefined step", () => {
    expect(() => orderMigrationSteps([{ name: "recompute", dependsOn: ["backfill"] }])).toThrow(
      'Step "recompute" depends on undefined step "backfill"',
    );
  });

  test("rejects a step that depends on itself", () => {
    expect(() => orderMigrationSteps([{ name: "recompute", dependsOn: ["recompute"] }])).toThrow(
      'Step "recompute" depends on itself',
    );
  });

  test("rejects a dependency listed twice", () => {
    expect(() =>
      orderMigrationSteps([
        { name: "backfill", dependsOn: [] },
        { name: "recompute", dependsOn: ["backfill", "backfill"] },
      ]),
    ).toThrow('Step "recompute" lists dependency "backfill" more than once');
  });

  test("rejects a dependency cycle and names the steps it blocks", () => {
    expect(() =>
      orderMigrationSteps([
        { name: "independent", dependsOn: [] },
        { name: "first", dependsOn: ["second"] },
        { name: "second", dependsOn: ["first"] },
      ]),
    ).toThrow("Steps first, second cannot be ordered because their dependencies form a cycle");
  });

  test("reports every problem at once", () => {
    let message = "";
    try {
      orderMigrationSteps([
        { name: "bad-name", dependsOn: [] },
        { name: "recompute", dependsOn: ["missing"] },
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Step name "bad-name" is invalid');
    expect(message).toContain('Step "recompute" depends on undefined step "missing"');
  });
});

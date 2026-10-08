import { describe, expect, test, vi } from "vitest";
import {
  assertMigrationSkipSteps,
  assertSkipNamespacesKnown,
  parseMigrationSkipSteps,
} from "./migration-skip-steps";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { OperatorClient } from "#/cli/shared/client";

const assertSkippableSteps = vi.hoisted(() => vi.fn(async (_options: unknown) => {}));
vi.mock("./migration-workflow", () => ({
  assertSkippableSteps: (options: unknown) => assertSkippableSteps(options),
}));

describe("parseMigrationSkipSteps", () => {
  test("returns no steps when the option is absent", () => {
    expect(parseMigrationSkipSteps(undefined)).toEqual(new Map());
  });

  test("groups steps by namespace", () => {
    expect(parseMigrationSkipSteps("main/backfillUser,main/backfillInvoice,audit/copy")).toEqual(
      new Map([
        ["main", ["backfillUser", "backfillInvoice"]],
        ["audit", ["copy"]],
      ]),
    );
  });

  test("ignores a repeated entry", () => {
    expect(parseMigrationSkipSteps("main/a,main/a")).toEqual(new Map([["main", ["a"]]]));
  });

  test.each(["backfillUser", "main/", "/backfillUser", "main/a,,main/b"])(
    "rejects '%s', which is not <namespace>/<step>",
    (value) => {
      expect(() => parseMigrationSkipSteps(value)).toThrow(
        expect.objectContaining({ code: "MIGRATION_SKIP_STEPS_FORMAT_INVALID" }),
      );
    },
  );

  test("tells which entry is malformed and what a valid one looks like", () => {
    expect(() => parseMigrationSkipSteps("main/a,oops")).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("'oops'"),
        suggestion: expect.stringContaining("<namespace>/<step>"),
        context: { entry: "oops" },
      }),
    );
  });
});

describe("assertMigrationSkipSteps", () => {
  const client = {} as OperatorClient;
  const stepsMigration = (namespace: string, number: number): PendingMigration =>
    ({
      namespace,
      number,
      hasScript: true,
      scriptForm: { kind: "steps", order: ["a", "b"] },
    }) as PendingMigration;

  test("checks the steps against the run the namespace's migration is in progress with", async () => {
    await assertMigrationSkipSteps({
      client,
      workspaceId: "ws-1",
      requested: new Map([["main", ["a"]]]),
      pendingMigrations: [stepsMigration("main", 3)],
      inProgressByNamespace: { main: { number: 3, executionId: "exec-1" } },
    });

    expect(assertSkippableSteps).toHaveBeenCalledWith({
      client,
      workspaceId: "ws-1",
      namespace: "main",
      migrationNumber: 3,
      order: ["a", "b"],
      inProgress: { number: 3, executionId: "exec-1" },
      requested: ["a"],
    });
  });

  test("rejects a namespace that has no pending steps migration", async () => {
    await expect(
      assertMigrationSkipSteps({
        client,
        workspaceId: "ws-1",
        requested: new Map([["audit", ["a"]]]),
        pendingMigrations: [stepsMigration("main", 3)],
        inProgressByNamespace: { main: { number: 3 } },
      }),
    ).rejects.toMatchObject({
      code: "MIGRATION_SKIP_STEPS_INVALID",
      context: { namespace: "audit", requested: ["a"] },
    });
  });

  test("rejects a migration an earlier deploy did not leave in progress", async () => {
    await expect(
      assertMigrationSkipSteps({
        client,
        workspaceId: "ws-1",
        requested: new Map([["main", ["a"]]]),
        pendingMigrations: [stepsMigration("main", 3)],
        inProgressByNamespace: {},
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_SKIP_STEPS_INVALID" });
  });
});

describe("assertSkipNamespacesKnown", () => {
  test("accepts namespaces that some deployed config defines", () => {
    expect(() =>
      assertSkipNamespacesKnown(new Map([["main", ["a"]]]), new Set(["main", "audit"])),
    ).not.toThrow();
  });

  test("rejects a namespace no deployed config defines, listing the ones that exist", () => {
    expect(() =>
      assertSkipNamespacesKnown(new Map([["mian", ["a"]]]), new Set(["main", "audit"])),
    ).toThrow(
      expect.objectContaining({
        code: "MIGRATION_SKIP_STEPS_INVALID",
        message: expect.stringContaining("'mian'"),
        suggestion: expect.stringContaining("main, audit"),
        context: { namespace: "mian", requested: ["a"], namespaces: ["main", "audit"] },
      }),
    );
  });
});

import { describe, expect, test } from "vitest";
import { createChangeSet, formatPlanSummary, summarizeChangeSets } from "./change-set";
import type { HasName } from "./change-set";

function createNamedChangeSet(title: string) {
  return createChangeSet<HasName, HasName, HasName, HasName>(title);
}

describe("ChangeSet.lines", () => {
  test("renders an item's optional details indented beneath it", () => {
    const changeSet = createNamedChangeSet("Applications");
    changeSet.updates.push({
      name: "my-app",
      details: ["~ get-user (httpAdapter)", "+ echo (httpAdapter)"],
    });

    const lines = changeSet.lines();
    expect(lines.some((line) => line.includes("my-app"))).toBe(true);
    expect(lines).toContain("    ~ get-user (httpAdapter)");
    expect(lines).toContain("    + echo (httpAdapter)");
  });

  test("marks updates forced by the SDK version", () => {
    const changeSet = createNamedChangeSet("AIGateways");
    changeSet.updates.push({ name: "forced", forcedBySdkVersion: true }, { name: "changed" });

    const lines = changeSet.lines();
    expect(lines.find((line) => line.includes("forced"))).toContain("[forced by SDK version]");
    expect(lines.find((line) => line.includes("changed"))).not.toContain("forced by SDK version");
  });

  test("returns empty array when change set is empty", () => {
    expect(createNamedChangeSet("Applications").lines()).toEqual([]);
  });
});

describe("summarizeChangeSets", () => {
  test("summarizes resource counts for plan output", () => {
    const create = createNamedChangeSet("Executors");
    create.creates.push({ name: "executor-a" }, { name: "executor-b" });

    const update = createNamedChangeSet("Resolvers");
    update.updates.push({ name: "resolver-a" }, { name: "resolver-b" }, { name: "resolver-c" });

    const deleteSet = createNamedChangeSet("Secrets");
    deleteSet.deletes.push({ name: "secret-a" });

    const replace = createNamedChangeSet("OAuth2 clients");
    replace.replaces.push({ name: "client-a" }, { name: "client-b" });

    expect(summarizeChangeSets([create, update, deleteSet, replace])).toEqual({
      create: 2,
      update: 3,
      delete: 1,
      replace: 2,
      forcedBySdkVersion: 0,
    });
  });

  test("counts updates forced by the SDK version as a subset of updates", () => {
    const update = createNamedChangeSet("Resolvers");
    update.updates.push(
      { name: "resolver-a", forcedBySdkVersion: true },
      { name: "resolver-b" },
      { name: "resolver-c", forcedBySdkVersion: true },
    );

    expect(summarizeChangeSets([update])).toEqual({
      create: 0,
      update: 3,
      delete: 0,
      replace: 0,
      forcedBySdkVersion: 2,
    });
  });
});

describe("formatPlanSummary", () => {
  test("omits replace count when there are no replacements", () => {
    expect(
      formatPlanSummary({ create: 1, update: 2, delete: 0, replace: 0, forcedBySdkVersion: 0 }),
    ).toBe("Plan: 1 to create, 2 to update, 0 to delete");
  });

  test("includes replace count when replacements exist", () => {
    expect(
      formatPlanSummary({ create: 1, update: 2, delete: 0, replace: 3, forcedBySdkVersion: 0 }),
    ).toBe("Plan: 1 to create, 2 to update, 0 to delete, 3 to replace");
  });

  test("breaks out updates forced by the SDK version", () => {
    expect(
      formatPlanSummary({ create: 0, update: 12, delete: 0, replace: 0, forcedBySdkVersion: 11 }),
    ).toBe("Plan: 0 to create, 12 to update (11 forced by SDK version), 0 to delete");
  });
});

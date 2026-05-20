import { describe, expect, test } from "vitest";
import { createChangeSet, formatPlanSummary, summarizeChangeSets } from "./change-set";
import type { HasName } from "./change-set";

function createNamedChangeSet(title: string) {
  return createChangeSet<HasName, HasName, HasName, HasName>(title);
}

describe("summarizeChangeSets", () => {
  test("summarizes resource counts for plan output", () => {
    const unchanged = createNamedChangeSet("Applications");
    unchanged.unchanged.push({ name: "app-a" }, { name: "app-b" });

    const create = createNamedChangeSet("Executors");
    create.creates.push({ name: "executor-a" }, { name: "executor-b" });

    const update = createNamedChangeSet("Resolvers");
    update.updates.push({ name: "resolver-a" }, { name: "resolver-b" }, { name: "resolver-c" });

    const deleteSet = createNamedChangeSet("Secrets");
    deleteSet.deletes.push({ name: "secret-a" });

    const replace = createNamedChangeSet("OAuth2 clients");
    replace.replaces.push({ name: "client-a" }, { name: "client-b" });

    expect(summarizeChangeSets([unchanged, create, update, deleteSet, replace])).toEqual({
      create: 2,
      update: 3,
      delete: 1,
      replace: 2,
      unchanged: 2,
    });
  });
});

describe("formatPlanSummary", () => {
  test("omits replace count when there are no replacements", () => {
    expect(
      formatPlanSummary({
        create: 1,
        update: 2,
        delete: 0,
        replace: 0,
        unchanged: 15,
      }),
    ).toBe("Plan: 1 to create, 2 to update, 0 to delete");
  });

  test("includes replace count when replacements exist", () => {
    expect(
      formatPlanSummary({
        create: 1,
        update: 2,
        delete: 0,
        replace: 3,
        unchanged: 15,
      }),
    ).toBe("Plan: 1 to create, 2 to update, 0 to delete, 3 to replace");
  });
});

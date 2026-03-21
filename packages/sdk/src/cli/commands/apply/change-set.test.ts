import { describe, expect, test, vi } from "vitest";
import { createChangeSet, formatPlanSummary, summarizeChangeSets } from "./change-set";
import type { HasName } from "./change-set";

vi.mock("@/cli/shared/logger", () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
  },
  styles: {
    bold: (value: string) => value,
  },
  symbols: {
    create: "+",
    update: "~",
    delete: "-",
    replace: "+/-",
  },
}));

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
    ).toBe("Plan: 1 to create, 2 to update, 0 to delete, 15 unchanged");
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
    ).toBe("Plan: 1 to create, 2 to update, 0 to delete, 3 to replace, 15 unchanged");
  });
});

describe("ChangeSet.print", () => {
  test("prints detail lines only when detail output is enabled", async () => {
    const { logger } = await import("@/cli/shared/logger");
    const changeSet = createNamedChangeSet("Applications");
    changeSet.updates.push({ name: "app-a", details: ['cors[0]: remote="a" local="b"'] });

    changeSet.print();
    expect(logger.info).not.toHaveBeenCalled();

    changeSet.print({ detail: true });
    expect(logger.info).toHaveBeenCalledWith('    cors[0]: remote="a" local="b"', {
      mode: "plain",
    });
  });
});

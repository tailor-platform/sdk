import { describe, expect, test } from "vitest";
import { getUnsupportedMigrationHintLines } from "./generate";

describe("getUnsupportedMigrationHintLines", () => {
  test("requires clearing stored values before reusing an incompatible field name", () => {
    const hint = getUnsupportedMigrationHintLines().join("\n");

    expect(hint).toContain("Add an optional temporary field");
    expect(hint).toContain("make the old field optional");
    expect(hint).toContain("set the old field to null in the same update");
    expect(hint).toContain("Verify every old value is null");
    expect(hint).toContain("make subsequent reads fail");
  });
});

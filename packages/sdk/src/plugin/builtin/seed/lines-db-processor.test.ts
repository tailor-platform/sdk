import { describe, expect, test } from "vitest";
import { processLinesDb } from "./lines-db-processor";
import type { TailorDBType, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";

describe("processLinesDb", () => {
  test("reports a missing export name for a table", () => {
    const type = {
      name: "User",
      fields: {},
    } as TailorDBType;
    const source = {
      filePath: "/test/user.ts",
      exportName: "",
    } satisfies TypeSourceInfoEntry;

    expect(() => processLinesDb(type, source)).toThrow("Missing export name for table User");
  });
});

import { describe, expect, test } from "vitest";
import { normalizeDb } from "./normalize-db";

describe("normalizeDb", () => {
  test("keeps owned definitions and legacy external membership separate", () => {
    // oxlint-disable-next-line typescript/no-deprecated -- Verify legacy attachment compatibility until v3.
    expect(normalizeDb({ local: { files: ["tables/*.ts"] }, shared: { external: true } })).toEqual({
      local: {
        owned: true,
        inSubgraph: true,
        schemaSource: { kind: "files", config: { files: ["tables/*.ts"] } },
      },
      shared: { owned: false, inSubgraph: true, schemaSource: undefined },
    });
  });

  test("normalizes an omitted db to no namespaces", () => {
    expect(normalizeDb(undefined)).toEqual({});
  });
});

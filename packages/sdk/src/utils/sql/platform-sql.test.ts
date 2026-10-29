import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { analyzeWithPlatform, createPlatformSql } from "./platform-sql";

describe("createPlatformSql", () => {
  test("names the module file it cannot find", () => {
    const missing = path.join(import.meta.dirname, "missing.wasm");

    expect(() => createPlatformSql(missing)).toThrow(missing);
  });
});

describe("analyzeWithPlatform", () => {
  const schema = JSON.stringify({
    Order: {
      _settings: { publishRecordEvents: false },
      fields: {
        amount: {
          _type: "integer",
          _required: true,
          _unique: false,
          _array: false,
          _foreignKey: false,
          _vector: false,
        },
      },
    },
  });

  test("returns the analyzer's error located in the source", () => {
    const source = 'SELECT "nope" FROM "Order" WHERE "amount" = :a';

    expect(analyzeWithPlatform(source, schema)).toEqual({
      ok: false,
      message: "field 'nope' not found",
      start: source.indexOf('"nope"'),
      end: source.indexOf('"nope"') + '"nope"'.length,
    });
  });

  test("throws for a schema the analyzer cannot read", () => {
    expect(() => analyzeWithPlatform('SELECT "id" FROM "Order"', '{"Order": {}}')).toThrow(
      "TailorDB's SQL analyzer cannot read the schema",
    );
  });
});

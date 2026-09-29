import { describe, expect, test } from "vitest";
import { COLUMN_TYPE_ALIASES, mapFieldTypeToColumnType } from "./field-column-type";

describe("mapFieldTypeToColumnType", () => {
  test.each([
    ["uuid", "string"],
    ["string", "string"],
    ["decimal", "string"],
    ["time", "string"],
    ["integer", "number"],
    ["float", "number"],
    ["number", "string"],
    ["date", "Timestamp"],
    ["datetime", "Timestamp"],
    ["bool", "boolean"],
    ["boolean", "boolean"],
  ] as const)("maps %s to %s", (fieldType, expected) => {
    expect(mapFieldTypeToColumnType(fieldType)).toBe(expected);
  });

  test.each(["enum", "nested"])("rejects %s, which carries its own shape", (fieldType) => {
    expect(() => mapFieldTypeToColumnType(fieldType)).toThrow(/resolve it before mapping/);
  });

  test.each([
    ["date", "TemporalDate"],
    ["datetime", "TemporalInstant"],
    ["time", "TemporalTime"],
  ] as const)("maps %s to %s when temporal is true", (fieldType, expected) => {
    expect(mapFieldTypeToColumnType(fieldType, true)).toBe(expected);
  });

  test.each(["uuid", "string", "decimal", "integer", "float", "bool", "boolean"])(
    "leaves %s unaffected when temporal is true",
    (fieldType) => {
      expect(mapFieldTypeToColumnType(fieldType, true)).toBe(mapFieldTypeToColumnType(fieldType));
    },
  );
});

describe("COLUMN_TYPE_ALIASES", () => {
  test("holds the aliases both type generators report usage for", () => {
    expect([...COLUMN_TYPE_ALIASES.keys()]).toEqual([
      "Timestamp",
      "TemporalDate",
      "TemporalInstant",
      "TemporalTime",
    ]);
  });

  test("expands Timestamp to the slots its alias declaration uses", () => {
    expect(COLUMN_TYPE_ALIASES.get("Timestamp")).toEqual({
      select: "Date",
      write: "Date | string",
    });
  });

  test.each([
    ["TemporalDate", "Temporal.PlainDate"],
    ["TemporalInstant", "Temporal.Instant"],
    ["TemporalTime", "Temporal.PlainTime"],
  ] as const)("expands %s to the slots its alias declaration uses", (alias, temporalType) => {
    expect(COLUMN_TYPE_ALIASES.get(alias)).toEqual({
      select: temporalType,
      write: `${temporalType} | string`,
    });
  });
});

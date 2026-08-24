import { describe, expect, test } from "vitest";
import { mapFieldTypeToColumnType } from "./field-column-type";

describe("mapFieldTypeToColumnType", () => {
  test.each([
    ["uuid", "string"],
    ["string", "string"],
    ["decimal", "string"],
    ["time", "string"],
    ["integer", "number"],
    ["float", "number"],
    ["number", "number"],
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
});

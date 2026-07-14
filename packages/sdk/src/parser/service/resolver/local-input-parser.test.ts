import { describe, expect, test } from "vitest";
import { buildLocalInputParser } from "./local-input-parser";

const requiredField = {
  _parseInternal: ({ value, pathArray }: { value: unknown; pathArray: string[] }) =>
    value === undefined
      ? { issues: [{ message: "Required field is missing", path: pathArray }] }
      : { value },
};

describe("buildLocalInputParser", () => {
  test("parses a valid record with no issues", () => {
    const parser = buildLocalInputParser({ name: requiredField });
    const result = parser.parse({ value: { name: "a" }, data: {}, user: {} });
    expect(result.issues).toBeUndefined();
  });

  test("collects issues from every field", () => {
    const parser = buildLocalInputParser({ name: requiredField, age: requiredField });
    const result = parser.parse({ value: {}, data: {}, user: {} });
    expect(result.issues).toEqual([
      { message: "Required field is missing", path: ["name"] },
      { message: "Required field is missing", path: ["age"] },
    ]);
  });

  test("rejects a top-level array even when all fields are optional", () => {
    const parser = buildLocalInputParser({});
    const result = parser.parse({ value: [1, 2, 3], data: {}, user: {} });
    expect(result.issues).toEqual([{ message: "Expected an object: received 1,2,3" }]);
  });

  test("rejects null and primitive top-level values", () => {
    const parser = buildLocalInputParser({});
    expect(parser.parse({ value: null, data: {}, user: {} }).issues).toEqual([
      { message: "Expected an object: received null" },
    ]);
    expect(parser.parse({ value: "hello", data: {}, user: {} }).issues).toEqual([
      { message: "Expected an object: received hello" },
    ]);
  });

  test("rejects a Date as a top-level value", () => {
    const parser = buildLocalInputParser({});
    const result = parser.parse({ value: new Date(), data: {}, user: {} });
    expect(result.issues?.[0]?.message).toMatch(/^Expected an object:/);
  });
});

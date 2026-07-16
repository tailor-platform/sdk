import { describe, expect, test } from "vitest";
import { parseInputFields, type FieldRuntime } from "./field-parse";
import type { TailorPrincipal } from "./types";

const invoker: TailorPrincipal = {
  id: "00000000-0000-0000-0000-000000000000",
  type: "machine_user",
  workspaceId: "",
  attributes: {},
  attributeList: [],
};

const stringField = (metadata: FieldRuntime["_metadata"] = { required: true }): FieldRuntime => ({
  type: "string",
  fields: {},
  _metadata: metadata,
});

describe("parseInputFields", () => {
  test("parses a valid record with no issues", () => {
    const result = parseInputFields({
      fields: { name: stringField() },
      value: { name: "a" },
      data: {},
      invoker,
    });
    expect(result.issues).toBeUndefined();
  });

  test("collects issues from every field", () => {
    const result = parseInputFields({
      fields: { name: stringField(), age: stringField() },
      value: {},
      data: {},
      invoker,
    });
    expect(result.issues).toEqual([
      { message: "Required field is missing", path: ["name"] },
      { message: "Required field is missing", path: ["age"] },
    ]);
  });

  test("runs custom validation when base validation passes", () => {
    const result = parseInputFields({
      fields: {
        name: stringField({
          required: true,
          validate: [
            ({ value }) =>
              typeof value === "string" && value.length > 2 ? undefined : "Too short",
          ],
        }),
      },
      value: { name: "ab" },
      data: {},
      invoker,
    });
    expect(result.issues).toEqual([{ message: "Too short", path: ["name"] }]);
  });

  test("rejects a top-level array even when all fields are optional", () => {
    const result = parseInputFields({ fields: {}, value: [1, 2, 3], data: {}, invoker });
    expect(result.issues).toEqual([{ message: "Expected an object: received 1,2,3" }]);
  });

  test("rejects a missing top-level value as a required field", () => {
    const result = parseInputFields({ fields: {}, value: null, data: {}, invoker });
    expect(result.issues).toEqual([{ message: "Required field is missing" }]);
  });

  test("rejects primitive top-level values", () => {
    const result = parseInputFields({ fields: {}, value: "hello", data: {}, invoker });
    expect(result.issues).toEqual([{ message: "Expected an object: received hello" }]);
  });

  test("rejects a Date as a top-level value", () => {
    const result = parseInputFields({ fields: {}, value: new Date(), data: {}, invoker });
    expect(result.issues?.[0]?.message).toMatch(/^Expected an object:/);
  });
});

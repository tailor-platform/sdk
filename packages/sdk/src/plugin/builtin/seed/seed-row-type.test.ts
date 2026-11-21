import { describe, expect, test } from "vitest";
import { generateSeedRowType } from "./seed-row-type";

describe("generateSeedRowType", () => {
  test("types a required scalar field without null", () => {
    const rowType = generateSeedRowType({
      fields: { name: { type: "string", required: true } },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain("name: string;");
  });

  test("lets a field that is not required be absent or null", () => {
    const rowType = generateSeedRowType({
      fields: { note: { type: "string" } },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain("note?: string | null;");
  });

  test("lets a required field the platform fills be absent or null", () => {
    const rowType = generateSeedRowType({
      fields: { code: { type: "string", required: true } },
      optionalFields: ["code"],
      omitFields: [],
    });

    expect(rowType).toContain("code?: string | null;");
  });

  test("lets the id be absent or null", () => {
    const rowType = generateSeedRowType({
      fields: { id: { type: "uuid", required: true } },
      optionalFields: ["id"],
      omitFields: [],
    });

    expect(rowType).toContain("id?: string | null;");
  });

  test("leaves out the fields the platform assigns", () => {
    const rowType = generateSeedRowType({
      fields: { number: { type: "integer", required: true } },
      optionalFields: ["id"],
      omitFields: ["number"],
    });

    expect(rowType).not.toContain("number");
  });

  test.each([
    ["uuid", "string"],
    ["string", "string"],
    ["decimal", "string"],
    ["date", "string"],
    ["time", "string"],
    ["integer", "number"],
    ["float", "number"],
    ["boolean", "boolean"],
    ["datetime", "string | Date"],
  ])("maps a %s field to %s", (type, expected) => {
    const rowType = generateSeedRowType({
      fields: { value: { type, required: true } },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain(`value: ${expected};`);
  });

  test("maps an enum field to the union of its values", () => {
    const rowType = generateSeedRowType({
      fields: {
        kind: { type: "enum", required: true, allowedValues: ["a", { value: "b" }] },
      },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain('kind: "a" | "b";');
  });

  test("maps an array field to an array of its element type", () => {
    const rowType = generateSeedRowType({
      fields: {
        tags: { type: "string", required: true, array: true },
        times: { type: "datetime", required: true, array: true },
        kinds: { type: "enum", required: true, array: true, allowedValues: ["a", "b"] },
      },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain("tags: string[];");
    expect(rowType).toContain("times: (string | Date)[];");
    expect(rowType).toContain('kinds: ("a" | "b")[];');
  });

  test("keeps null outside the array of an array field that is not required", () => {
    const rowType = generateSeedRowType({
      fields: { tags: { type: "string", array: true } },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain("tags?: string[] | null;");
  });

  test("maps a nested field to an object of its fields", () => {
    const rowType = generateSeedRowType({
      fields: {
        meta: {
          type: "nested",
          required: true,
          fields: {
            x: { type: "string", required: true },
            y: { type: "integer" },
          },
        },
      },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain("meta: { x: string; y?: number | null };");
  });

  test("quotes a field name that is not an identifier", () => {
    const rowType = generateSeedRowType({
      fields: {
        "my-field": { type: "string", required: true },
        "1st": { type: "integer", required: true },
        meta: {
          type: "nested",
          required: true,
          fields: { "x-y": { type: "string", required: true }, plain: { type: "string" } },
        },
      },
      optionalFields: [],
      omitFields: [],
    });

    expect(rowType).toContain('"my-field": string;');
    expect(rowType).toContain('"1st": number;');
    expect(rowType).toContain('meta: { "x-y": string; plain?: string | null };');
  });

  test("writes the row type seed-row-type.test-d.ts holds against the type of a table in TypeScript source", () => {
    const rowType = generateSeedRowType({
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
        note: { type: "string" },
        tags: { type: "string", required: true, array: true },
        count: { type: "integer", required: true },
        ratio: { type: "float" },
        ok: { type: "boolean", required: true },
        at: { type: "datetime", required: true },
        day: { type: "date" },
        clock: { type: "time", required: true },
        amount: { type: "decimal", required: true },
        kind: { type: "enum", required: true, allowedValues: ["a", "b"] },
        ref: { type: "uuid", required: true },
        meta: {
          type: "nested",
          required: true,
          fields: { x: { type: "string", required: true }, y: { type: "integer" } },
        },
        createdAt: { type: "datetime", required: true },
        updatedAt: { type: "datetime", required: true },
      },
      optionalFields: ["id", "createdAt", "updatedAt"],
      omitFields: [],
    });

    expect(rowType).toBe(`{
  id?: string | null;
  name: string;
  note?: string | null;
  tags: string[];
  count: number;
  ratio?: number | null;
  ok: boolean;
  at: string | Date;
  day?: string | null;
  clock: string;
  amount: string;
  kind: "a" | "b";
  ref: string;
  meta: { x: string; y?: number | null };
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}`);
  });
});

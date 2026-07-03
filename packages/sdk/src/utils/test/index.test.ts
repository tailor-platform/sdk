import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { t } from "#/configure/types/index";
import { createStandardSchema, createTailorDBHook } from "./index";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("createTailorDBHook", () => {
  describe("id field", () => {
    test("uses existing id from data when provided", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)({
        id: "00000000-0000-0000-0000-000000000001",
        name: "a",
      });
      expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
    });

    test.each([
      ["data has no id", { name: "b" }],
      ["data is null", null],
      ["data is undefined", undefined],
    ])("generates a UUID when %s", (_label, data) => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)(data);
      expect(result.id).toMatch(UUID_REGEX);
    });
  });

  describe("plain field passthrough", () => {
    test("passes through scalar field values unchanged", () => {
      const type = db.type("Test", {
        name: db.string(),
        age: db.int(),
        active: db.bool(),
      });
      const result = createTailorDBHook(type)({
        name: "alice",
        age: 30,
        active: true,
      });
      expect(result).toMatchObject({ name: "alice", age: 30, active: true });
    });

    test.each([
      ["data is null", null],
      ["data is a non-object primitive", "not-an-object"],
    ])("does not set scalar fields when %s", (_label, data) => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)(data);
      expect(result.name).toBeUndefined();
    });

    test("preserves explicit null values from data", () => {
      const type = db.type("Test", { nickname: db.string({ optional: true }) });
      const result = createTailorDBHook(type)({ nickname: null });
      expect(result.nickname).toBeNull();
    });
  });

  describe("single nested object field", () => {
    test("recursively processes the nested object", () => {
      const type = db.type("Test", {
        user: db.object({ name: db.string(), age: db.int() }),
      });
      const result = createTailorDBHook(type)({
        user: { name: "alice", age: 30 },
      });
      expect(result.user).toMatchObject({ name: "alice", age: 30 });
    });

    test("generates a nested id when the nested object has an id field", () => {
      const type = db.type("Test", {
        nested: db.object({ id: db.uuid(), name: db.string() }),
      });
      const result = createTailorDBHook(type)({ nested: { name: "x" } });
      expect((result.nested as { id: string }).id).toMatch(UUID_REGEX);
    });

    test("invokes nested sub-field hooks", () => {
      const type = db.type("Test", {
        user: db.object({
          name: db.string().hooks({
            create: ({ value }) => `hooked:${value as string}`,
          }),
        }),
      });
      const result = createTailorDBHook(type)({ user: { name: "alice" } });
      expect(result.user).toMatchObject({ name: "hooked:alice" });
    });
  });

  describe("nested object array field", () => {
    test("preserves array values when array is provided", () => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string(), days: db.int() }, { array: true }),
      });
      const value = [
        { kind: "NET_DAYS", days: 30 },
        { kind: "NET_DAYS", days: 60 },
      ];
      const result = createTailorDBHook(type)({ lines: value });
      expect(result.lines).toEqual(value);
    });

    test("recursively processes each array element so nested ids are generated", () => {
      const type = db.type("Test", {
        lines: db.object({ id: db.uuid(), kind: db.string() }, { array: true }),
      });
      const result = createTailorDBHook(type)({
        lines: [{ kind: "A" }, { kind: "B" }],
      });
      expect(Array.isArray(result.lines)).toBe(true);
      expect(result.lines).toHaveLength(2);
      expect((result.lines as { id: string }[])[0]!.id).toMatch(UUID_REGEX);
      expect((result.lines as { id: string }[])[1]!.id).toMatch(UUID_REGEX);
    });

    test("invokes per-element sub-field hooks", () => {
      const calls: unknown[] = [];
      const type = db.type("Test", {
        lines: db.object(
          {
            stamp: db.string().hooks({
              create: ({ value }) => {
                calls.push(value);
                return `stamped:${value as string}`;
              },
            }),
          },
          { array: true },
        ),
      });
      const result = createTailorDBHook(type)({
        lines: [{ stamp: "x" }, { stamp: "y" }],
      });
      expect(calls).toEqual(["x", "y"]);
      expect(result.lines).toEqual([{ stamp: "stamped:x" }, { stamp: "stamped:y" }]);
    });

    test("preserves an empty array as an empty array", () => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string() }, { array: true }),
      });
      const result = createTailorDBHook(type)({ lines: [] });
      expect(result.lines).toEqual([]);
    });

    test.each([
      ["passes through null for optional array field", { lines: null }, null],
      ["passes through undefined for omitted optional array field", {}, undefined],
    ])("%s", (_label, data, expected) => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string() }, { optional: true, array: true }),
      });
      expect(createTailorDBHook(type)(data).lines).toBe(expected);
    });

    test("passes through non-array values without recursing (so the validator surfaces a clear error)", () => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string() }, { array: true }),
      });
      // Pass an object instead of an array; the hook must not corrupt it into a single
      // recursed object — otherwise downstream validation cannot report "Expected an array".
      const bogus = { kind: "X" };
      const result = createTailorDBHook(type)({ lines: bogus });
      expect(result.lines).toBe(bogus);
    });
  });

  describe("create hook on a top-level field", () => {
    test("invokes the create hook with value, full data, and a null invoker", () => {
      const seen: { value: unknown; data: unknown; invoker: unknown }[] = [];
      const type = db.type("Order", { total: db.float(), tax: db.float() }).hooks({
        tax: {
          create: ({ value, data, invoker }) => {
            seen.push({ value, data, invoker });
            return (data as { total: number }).total * 0.1;
          },
        },
      });
      const result = createTailorDBHook(type)({ total: 100, tax: undefined });
      expect(result.tax).toBe(10);
      expect(seen).toEqual([
        {
          value: undefined,
          data: { total: 100, tax: undefined },
          invoker: null,
        },
      ]);
    });

    test("normalizes a Date returned from the create hook to an ISO string", () => {
      const fixed = new Date("2026-04-15T00:00:00.000Z");
      const type = db
        .type("Test", { createdAt: db.datetime() })
        .hooks({ createdAt: { create: () => fixed } });
      expect(createTailorDBHook(type)({}).createdAt).toBe("2026-04-15T00:00:00.000Z");
    });

    test("does not invoke a hook that only defines update (createTailorDBHook is create-only)", () => {
      let updateCalled = false;
      const type = db.type("Test", { updatedAt: db.datetime() }).hooks({
        updatedAt: {
          update: () => {
            updateCalled = true;
            return new Date();
          },
        },
      });
      const result = createTailorDBHook(type)({ updatedAt: "2026-01-01T00:00:00.000Z" });
      expect(updateCalled).toBe(false);
      // Falls through to plain passthrough
      expect(result.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });
});

describe("createStandardSchema", () => {
  const buildSchema = () => {
    const type = db.type("PurchaseOrder", {
      paymentTermSnapshotLines: db.object(
        { kind: db.string(), days: db.int() },
        { optional: true, array: true },
      ),
    });
    const schemaType = t.object({
      id: t.uuid(),
      paymentTermSnapshotLines: t.object(
        { kind: t.string(), days: t.int() },
        { optional: true, array: true },
      ),
    });
    return createStandardSchema(schemaType, createTailorDBHook(type));
  };

  test("returns a value when the hooked data passes validation (array)", () => {
    const result = buildSchema()["~standard"].validate({
      paymentTermSnapshotLines: [{ kind: "NET_DAYS", days: 30 }],
    });
    expect(result).toHaveProperty("value");
    expect((result as { value: unknown }).value).toMatchObject({
      paymentTermSnapshotLines: [{ kind: "NET_DAYS", days: 30 }],
    });
  });

  test.each([
    ["null", { paymentTermSnapshotLines: null }],
    ["omitted", {}],
  ])("returns a value when the optional array field is %s", (_label, input) => {
    const result = buildSchema()["~standard"].validate(input);
    expect(result).toHaveProperty("value");
  });

  test("returns issues when the hooked data fails validation", () => {
    const type = db.type("Test", { name: db.string() });
    const schemaType = t.object({ id: t.uuid(), name: t.string() });
    const schema = createStandardSchema(schemaType, createTailorDBHook(type));

    // name is required as a string; passing a number triggers a type issue.
    const result = schema["~standard"].validate({ name: 42 });
    expect(result).toHaveProperty("issues");
    expect((result as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });
});

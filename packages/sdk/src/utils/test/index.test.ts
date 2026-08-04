import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { t } from "#/configure/types/index";
import { createStandardSchema, createTailorDBHook } from "./index";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("createTailorDBHook", () => {
  describe("id field", () => {
    test("uses existing id from data when provided", () => {
      const type = db.table("Test", { name: db.string() });
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
      const type = db.table("Test", { name: db.string() });
      const result = createTailorDBHook(type)(data);
      expect(result.id).toMatch(UUID_REGEX);
    });
  });

  describe("plain field passthrough", () => {
    test("passes through scalar field values unchanged", () => {
      const type = db.table("Test", {
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
      const type = db.table("Test", { name: db.string() });
      const result = createTailorDBHook(type)(data);
      expect(result.name).toBeUndefined();
    });

    test("preserves explicit null values from data", () => {
      const type = db.table("Test", { nickname: db.string({ optional: true }) });
      const result = createTailorDBHook(type)({ nickname: null });
      expect(result.nickname).toBeNull();
    });

    test("keeps a field the data does not carry as an undefined key", () => {
      const type = db.table("Test", {
        name: db.string(),
        nickname: db.string({ optional: true }),
      });
      const result = createTailorDBHook(type)({ name: "alice" });
      // The key has to stay: a database schema inferred from these records reads
      // the `undefined` as a null and makes the column nullable, which is what
      // lets a row that omits the field be inserted at all.
      expect(Object.hasOwn(result, "nickname")).toBe(true);
      expect(result.nickname).toBeUndefined();
    });

    test("does not take a field named after an Object member off the prototype", () => {
      const type = db.table("Test", {
        name: db.string(),
        toString: db.string({ optional: true }),
      });
      const result = createTailorDBHook(type)({ name: "alice" });
      expect(Object.entries(result)).toContainEqual(["toString", undefined]);
    });

    test("passes through a field named after an Object member when the data carries it", () => {
      const type = db.table("Test", {
        name: db.string(),
        toString: db.string({ optional: true }),
      });
      const result = createTailorDBHook(type)({ name: "alice", toString: "kept" });
      expect(Object.entries(result)).toContainEqual(["toString", "kept"]);
    });
  });

  describe("single nested object field", () => {
    test("recursively processes the nested object", () => {
      const type = db.table("Test", {
        user: db.object({ name: db.string(), age: db.int() }),
      });
      const result = createTailorDBHook(type)({
        user: { name: "alice", age: 30 },
      });
      expect(result.user).toMatchObject({ name: "alice", age: 30 });
    });

    test("generates a nested id when the nested object has an id field", () => {
      const type = db.table("Test", {
        nested: db.object({ id: db.uuid(), name: db.string() }),
      });
      const result = createTailorDBHook(type)({ nested: { name: "x" } });
      expect((result.nested as { id: string }).id).toMatch(UUID_REGEX);
    });

    test("invokes nested sub-field hooks", () => {
      const type = db.table("Test", {
        user: db.object({
          // @ts-expect-error hooks on nested inner fields are now type-blocked
          name: db.string().hooks({
            create: ({ input }) => `hooked:${input as string}`,
          }),
        }),
      });
      const result = createTailorDBHook(type)({ user: { name: "alice" } });
      expect(result.user).toMatchObject({ name: "hooked:alice" });
    });
  });

  describe("nested object array field", () => {
    test("preserves array values when array is provided", () => {
      const type = db.table("Test", {
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
      const type = db.table("Test", {
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
      const type = db.table("Test", {
        lines: db.object(
          {
            // @ts-expect-error hooks on nested inner fields are now type-blocked
            stamp: db.string().hooks({
              create: ({ input }) => {
                calls.push(input);
                return `stamped:${input as string}`;
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
      const type = db.table("Test", {
        lines: db.object({ kind: db.string() }, { array: true }),
      });
      const result = createTailorDBHook(type)({ lines: [] });
      expect(result.lines).toEqual([]);
    });

    test.each([
      ["passes through null for optional array field", { lines: null }, null],
      ["passes through undefined for omitted optional array field", {}, undefined],
    ])("%s", (_label, data, expected) => {
      const type = db.table("Test", {
        lines: db.object({ kind: db.string() }, { optional: true, array: true }),
      });
      expect(createTailorDBHook(type)(data).lines).toBe(expected);
    });

    test("passes through non-array values without recursing (so the validator surfaces a clear error)", () => {
      const type = db.table("Test", {
        lines: db.object({ kind: db.string() }, { array: true }),
      });
      // Pass an object instead of an array; the hook must not corrupt it into a single
      // recursed object — otherwise downstream validation cannot report "Expected an array".
      const bogus = { kind: "X" };
      const result = createTailorDBHook(type)({ lines: bogus });
      expect(result.lines).toBe(bogus);
    });
  });

  describe("type-level create hook", () => {
    test("invokes the create hook and applies field overrides", () => {
      const seen: { input: unknown; invoker: unknown }[] = [];
      const type = db.table("Order", { total: db.float(), tax: db.float() }).hooks({
        create: ({ input, invoker }) => {
          seen.push({ input, invoker });
          return { tax: (input as { total: number }).total * 0.1 };
        },
      });
      const result = createTailorDBHook(type)({ total: 100, tax: undefined });
      expect(result.tax).toBe(10);
      expect(seen).toEqual([
        {
          input: { total: 100, tax: undefined },
          invoker: null,
        },
      ]);
    });

    test("normalizes a Date returned from the type hook to an ISO string", () => {
      const fixed = new Date("2026-04-15T00:00:00.000Z");
      const type = db
        .table("Test", { createdAt: db.datetime() })
        .hooks({ create: () => ({ createdAt: fixed }) });
      expect(createTailorDBHook(type)({}).createdAt).toBe("2026-04-15T00:00:00.000Z");
    });

    test("shares the same now timestamp between field-level and type-level hooks", () => {
      let fieldNow: Date | undefined;
      let typeNow: Date | undefined;
      const type = db
        .table("Test", {
          createdAt: db.datetime().hooks({ create: ({ now }) => (fieldNow = now) }),
          label: db.string(),
        })
        .hooks({ create: ({ now }) => ((typeNow = now), { label: "x" }) });
      createTailorDBHook(type)({});
      expect(fieldNow).toBeInstanceOf(Date);
      expect(typeNow).toBe(fieldNow);
    });

    test("runs type-level validate and throws on validation failure", () => {
      const type = db
        .table("Range", {
          start: db.int(),
          end: db.int(),
        })
        .validate(({ newRecord }, issues) => {
          if ((newRecord.start as number) > (newRecord.end as number)) {
            issues("start", "start must be <= end");
          }
        });
      expect(() => createTailorDBHook(type)({ start: 10, end: 5 })).toThrow(
        "Validation failed on field 'start': start must be <= end",
      );
      expect(() => createTailorDBHook(type)({ start: 1, end: 10 })).not.toThrow();
    });

    test("does not invoke a hook that only defines update (createTailorDBHook is create-only)", () => {
      let updateCalled = false;
      const type = db.table("Test", { updatedAt: db.datetime() }).hooks({
        update: () => {
          updateCalled = true;
          return { updatedAt: new Date() };
        },
      });
      const result = createTailorDBHook(type)({ updatedAt: "2026-01-01T00:00:00.000Z" });
      expect(updateCalled).toBe(false);
      expect(result.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    });
  });
});

describe("createStandardSchema", () => {
  const buildSchema = () => {
    const type = db.table("PurchaseOrder", {
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
    const type = db.table("Test", { name: db.string() });
    const schemaType = t.object({ id: t.uuid(), name: t.string() });
    const schema = createStandardSchema(schemaType, createTailorDBHook(type));

    // name is required as a string; passing a number triggers a type issue.
    const result = schema["~standard"].validate({ name: 42 });
    expect(result).toHaveProperty("issues");
    expect((result as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  test("returns a value when a field named after an Object member is omitted", () => {
    const type = db.table("Test", {
      name: db.string(),
      toString: db.string({ optional: true }),
    });
    const schemaType = t.object({
      id: t.uuid(),
      name: t.string(),
      toString: t.string({ optional: true }),
    });
    const schema = createStandardSchema(schemaType, createTailorDBHook(type));

    // The validator reads the hooked record by key, so `toString` has to resolve
    // to the field rather than to `Object.prototype.toString`.
    const result = schema["~standard"].validate({ name: "alice" });
    expect(result).toHaveProperty("value");
  });
});

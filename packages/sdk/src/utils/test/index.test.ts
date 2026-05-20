import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { t } from "@/configure/types";
import { createStandardSchema, createTailorDBHook } from "./index";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("createTailorDBHook", () => {
  describe("id field", () => {
    it("uses existing id from data when provided", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)({
        id: "00000000-0000-0000-0000-000000000001",
        name: "a",
      });
      expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
    });

    it("generates a UUID when data has no id", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)({ name: "b" });
      expect(result.id).toMatch(UUID_REGEX);
    });

    it("generates a UUID when data is null", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)(null);
      expect(result.id).toMatch(UUID_REGEX);
    });

    it("generates a UUID when data is undefined", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)(undefined);
      expect(result.id).toMatch(UUID_REGEX);
    });
  });

  describe("plain field passthrough", () => {
    it("passes through scalar field values unchanged", () => {
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

    it("does not set scalar fields when data is null", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)(null);
      expect(result.name).toBeUndefined();
    });

    it("does not set scalar fields when data is a non-object primitive", () => {
      const type = db.type("Test", { name: db.string() });
      const result = createTailorDBHook(type)("not-an-object");
      expect(result.name).toBeUndefined();
    });

    it("preserves explicit null values from data", () => {
      const type = db.type("Test", { nickname: db.string({ optional: true }) });
      const result = createTailorDBHook(type)({ nickname: null });
      expect(result.nickname).toBeNull();
    });
  });

  describe("single nested object field", () => {
    it("recursively processes the nested object", () => {
      const type = db.type("Test", {
        user: db.object({ name: db.string(), age: db.int() }),
      });
      const result = createTailorDBHook(type)({
        user: { name: "alice", age: 30 },
      });
      expect(result.user).toMatchObject({ name: "alice", age: 30 });
    });

    it("generates a nested id when the nested object has an id field", () => {
      const type = db.type("Test", {
        nested: db.object({ id: db.uuid(), name: db.string() }),
      });
      const result = createTailorDBHook(type)({ nested: { name: "x" } });
      expect((result.nested as { id: string }).id).toMatch(UUID_REGEX);
    });
  });

  describe("nested object array field", () => {
    it("preserves array values when array is provided", () => {
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

    it("recursively processes each array element so nested ids are generated", () => {
      const type = db.type("Test", {
        lines: db.object({ id: db.uuid(), kind: db.string() }, { array: true }),
      });
      const result = createTailorDBHook(type)({
        lines: [{ kind: "A" }, { kind: "B" }],
      });
      expect(Array.isArray(result.lines)).toBe(true);
      expect(result.lines).toHaveLength(2);
      expect((result.lines as { id: string }[])[0].id).toMatch(UUID_REGEX);
      expect((result.lines as { id: string }[])[1].id).toMatch(UUID_REGEX);
    });

    it("preserves an empty array as an empty array", () => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string() }, { array: true }),
      });
      const result = createTailorDBHook(type)({ lines: [] });
      expect(result.lines).toEqual([]);
    });

    it("passes through null for optional array field", () => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string() }, { optional: true, array: true }),
      });
      expect(createTailorDBHook(type)({ lines: null }).lines).toBeNull();
    });

    it("passes through undefined for omitted optional array field", () => {
      const type = db.type("Test", {
        lines: db.object({ kind: db.string() }, { optional: true, array: true }),
      });
      expect(createTailorDBHook(type)({}).lines).toBeUndefined();
    });

    it("passes through non-array values without recursing (so the validator surfaces a clear error)", () => {
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

  it("returns a value when the hooked data passes validation (array)", () => {
    const result = buildSchema()["~standard"].validate({
      paymentTermSnapshotLines: [{ kind: "NET_DAYS", days: 30 }],
    });
    expect(result).toHaveProperty("value");
    expect((result as { value: unknown }).value).toMatchObject({
      paymentTermSnapshotLines: [{ kind: "NET_DAYS", days: 30 }],
    });
  });

  it("returns a value when the optional array field is null", () => {
    const result = buildSchema()["~standard"].validate({
      paymentTermSnapshotLines: null,
    });
    expect(result).toHaveProperty("value");
  });

  it("returns a value when the optional array field is omitted", () => {
    const result = buildSchema()["~standard"].validate({});
    expect(result).toHaveProperty("value");
  });

  it("returns issues when the hooked data fails validation", () => {
    const type = db.type("Test", { name: db.string() });
    const schemaType = t.object({ id: t.uuid(), name: t.string() });
    const schema = createStandardSchema(schemaType, createTailorDBHook(type));

    // name is required as a string; passing a number triggers a type issue.
    const result = schema["~standard"].validate({ name: 42 });
    expect(result).toHaveProperty("issues");
    expect((result as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });
});

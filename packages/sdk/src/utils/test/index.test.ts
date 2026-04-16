import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { t } from "@/configure/types";
import { createStandardSchema, createTailorDBHook } from "./index";

describe("createTailorDBHook", () => {
  it("uses existing id when provided and generates one otherwise", () => {
    const type = db.type("Test", {
      name: db.string(),
    });
    const hook = createTailorDBHook(type);

    const withId = hook({ id: "00000000-0000-0000-0000-000000000001", name: "a" });
    expect(withId.id).toBe("00000000-0000-0000-0000-000000000001");

    const withoutId = hook({ name: "b" });
    expect(typeof withoutId.id).toBe("string");
    expect(withoutId.id).not.toBe(undefined);
  });

  it("recursively processes a single nested object", () => {
    const type = db.type("Test", {
      user: db.object({
        name: db.string(),
      }),
    });
    const hook = createTailorDBHook(type);

    const result = hook({ user: { name: "alice" } });
    expect(result.user).toEqual({ name: "alice" });
  });

  it("preserves array values for nested object array fields", () => {
    const type = db.type("Test", {
      lines: db.object(
        {
          kind: db.string(),
          days: db.int(),
        },
        { array: true },
      ),
    });
    const hook = createTailorDBHook(type);

    const value = [
      { kind: "NET_DAYS", days: 30 },
      { kind: "NET_DAYS", days: 60 },
    ];
    const result = hook({ lines: value });
    expect(result.lines).toEqual(value);
  });

  it("recursively processes each element of a nested object array so nested ids are generated", () => {
    const type = db.type("Test", {
      lines: db.object(
        {
          kind: db.string(),
        },
        { array: true },
      ),
    });
    const hook = createTailorDBHook(type);

    const result = hook({
      lines: [{ kind: "NET_DAYS" }, { kind: "NET_DAYS" }],
    });
    expect(Array.isArray(result.lines)).toBe(true);
    expect(result.lines).toHaveLength(2);
    expect(result.lines?.[0]).toMatchObject({ kind: "NET_DAYS" });
    expect(result.lines?.[1]).toMatchObject({ kind: "NET_DAYS" });
  });

  it("passes through null for optional nested object array fields", () => {
    const type = db.type("Test", {
      lines: db.object(
        {
          kind: db.string(),
        },
        { optional: true, array: true },
      ),
    });
    const hook = createTailorDBHook(type);

    const result = hook({ lines: null });
    expect(result.lines).toBeNull();
  });

  it("passes through undefined for omitted nested object array fields", () => {
    const type = db.type("Test", {
      lines: db.object(
        {
          kind: db.string(),
        },
        { optional: true, array: true },
      ),
    });
    const hook = createTailorDBHook(type);

    const result = hook({});
    expect(result.lines).toBeUndefined();
  });

  it("produces data that passes createStandardSchema validation for nested object arrays", () => {
    const type = db.type("PurchaseOrder", {
      paymentTermSnapshotLines: db.object(
        {
          kind: db.string(),
          days: db.int(),
        },
        { optional: true, array: true },
      ),
    });
    const hook = createTailorDBHook(type);
    const schemaType = t.object({
      id: t.uuid(),
      paymentTermSnapshotLines: t.object(
        {
          kind: t.string(),
          days: t.int(),
        },
        { optional: true, array: true },
      ),
    });
    const schema = createStandardSchema(schemaType, hook);

    const withArray = schema["~standard"].validate({
      paymentTermSnapshotLines: [{ kind: "NET_DAYS", days: 30 }],
    });
    expect(withArray).toHaveProperty("value");

    const withNull = schema["~standard"].validate({
      paymentTermSnapshotLines: null,
    });
    expect(withNull).toHaveProperty("value");

    const omitted = schema["~standard"].validate({});
    expect(omitted).toHaveProperty("value");
  });

  it("invokes field-level create hook with value, full data, and unauthenticated user", () => {
    const seen: { value: unknown; data: unknown; userId: string }[] = [];
    const type = db
      .type("Order", {
        total: db.float(),
        tax: db.float(),
      })
      .hooks({
        tax: {
          create: ({ value, data, user }) => {
            seen.push({ value, data, userId: user.id });
            return (data as { total: number }).total * 0.1;
          },
        },
      });
    const hook = createTailorDBHook(type);

    const result = hook({ total: 100, tax: undefined });
    expect(result.tax).toBe(10);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      value: undefined,
      data: { total: 100, tax: undefined },
      userId: "00000000-0000-0000-0000-000000000000",
    });
  });

  it("normalizes Date returned from a create hook to an ISO string", () => {
    const fixed = new Date("2026-04-15T00:00:00.000Z");
    const type = db
      .type("Test", {
        createdAt: db.datetime(),
      })
      .hooks({
        createdAt: {
          create: () => fixed,
        },
      });
    const hook = createTailorDBHook(type);

    const result = hook({});
    expect(result.createdAt).toBe("2026-04-15T00:00:00.000Z");
  });

  it("invokes nested-element hooks for each item of a nested object array", () => {
    const calls: unknown[] = [];
    const type = db.type("Test", {
      lines: db.object(
        {
          kind: db.string(),
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
    const hook = createTailorDBHook(type);

    const result = hook({
      lines: [
        { kind: "A", stamp: "x" },
        { kind: "B", stamp: "y" },
      ],
    });
    expect(calls).toEqual(["x", "y"]);
    expect(result.lines).toEqual([
      { kind: "A", stamp: "stamped:x" },
      { kind: "B", stamp: "stamped:y" },
    ]);
  });
});

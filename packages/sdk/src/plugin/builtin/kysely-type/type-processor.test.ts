import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { processKyselyType } from "./type-processor";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name]!;
}

async function getTypeDef(type: TailorAnyDBType) {
  const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));
  return result.typeDef;
}

describe("Kysely TypeProcessor", () => {
  describe("basic types", () => {
    test("should propagate the type name into the result", async () => {
      const type = db.type("User", {
        name: db.string(),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.name).toBe("User");
    });

    test.each([
      {
        name: "string types",
        type: db.type("User", {
          name: db.string(),
          nickname: db.string({ optional: true }),
        }),
        expected: ["name: string;", "nickname: string | null;"],
      },
      {
        name: "number types",
        type: db.type("Product", {
          quantity: db.int(),
          price: db.float(),
          discount: db.float({ optional: true }),
        }),
        expected: ["quantity: number;", "price: number;", "discount: number | null;"],
      },
      {
        name: "boolean types",
        type: db.type("Feature", {
          enabled: db.bool(),
          beta: db.bool({ optional: true }),
        }),
        expected: ["enabled: boolean;", "beta: boolean | null;"],
      },
      {
        name: "date and datetime types",
        type: db.type("Event", {
          startDate: db.date(),
          endDate: db.datetime(),
          cancelledAt: db.datetime({ optional: true }),
        }),
        expected: ["startDate: string;", "endDate: Timestamp;", "cancelledAt: Timestamp | null;"],
      },
      {
        name: "uuid types",
        type: db.type("Session", {
          userId: db.uuid(),
          deviceId: db.uuid({ optional: true }),
        }),
        expected: ["userId: string;", "deviceId: string | null;"],
      },
    ])("should handle $name", async ({ type, expected }) => {
      const typeDef = await getTypeDef(type);
      for (const substring of expected) expect(typeDef).toContain(substring);
    });
  });

  describe("array types", () => {
    test("should handle array fields", async () => {
      const typeDef = await getTypeDef(
        db.type("Post", {
          tags: db.string({ array: true }),
          scores: db.int({ array: true, optional: true }),
        }),
      );

      expect(typeDef).toContain("tags: string[];");
      expect(typeDef).toContain("scores: number[] | null;");
    });

    test("should use ArrayColumnType for datetime array fields", async () => {
      const typeDef = await getTypeDef(
        db.type("Event", {
          eventDates: db.datetime({ array: true }),
          optionalDates: db.date({ array: true, optional: true }),
        }),
      );

      expect(typeDef).toContain("eventDates: ArrayColumnType<Timestamp>;");
      expect(typeDef).toContain("optionalDates: string[] | null;");
    });
  });

  describe("enum types", () => {
    test("should handle enum types", async () => {
      const typeDef = await getTypeDef(
        db.type("User", {
          role: db.enum([{ value: "admin" }, { value: "user" }]),
          status: db.enum([{ value: "active" }, { value: "inactive" }], {
            optional: true,
          }),
        }),
      );

      expect(typeDef).toContain('role: "admin" | "user";');
      expect(typeDef).toContain('status: "active" | "inactive" | null;');
    });

    test("should handle enum array types", async () => {
      const typeDef = await getTypeDef(
        db.type("Article", {
          categories: db.enum(["tech", "health", "finance"], { array: true }),
          authors: db.enum(["alice", "bob"], { array: true, optional: true }),
        }),
      );

      expect(typeDef).toContain('categories: ("tech" | "health" | "finance")[];');
      expect(typeDef).toContain('authors: ("alice" | "bob")[] | null;');
    });
  });

  describe("nested objects", () => {
    test("should handle single level nested objects", async () => {
      const simpleNestedType = db.type("SimpleUser", {
        profile: db.object({
          name: db.string(),
          email: db.string({ optional: true }),
        }),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(simpleNestedType)));

      expect(result.name).toBe("SimpleUser");
      expect(result.typeDef).toContain("SimpleUser: ");
      expect(result.typeDef).toContain("profile:");
      expect(result.typeDef).toContain("ObjectColumnType<");
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("email?: string | null");
    });

    test("should handle multi-level nested objects", async () => {
      const deepNestedType = db.type("Company", {
        details: db.object({
          // @ts-expect-error: Nested objects have complex type inference
          address: db.object({
            street: db.string(),
            city: db.string(),
            zipCode: db.string({ optional: true }),
          }),
          // @ts-expect-error: Nested objects have complex type inference
          contact: db.object({
            email: db.string(),
            phone: db.string({ optional: true }),
          }),
        }),
      });

      const typeDef = await getTypeDef(deepNestedType);

      expect(typeDef).toContain("details:");
      expect(typeDef).toContain("address:");
      expect(typeDef).toContain("street: string");
      expect(typeDef).toContain("city: string");
      expect(typeDef).toContain("zipCode?: string | null");
      expect(typeDef).toContain("contact:");
      expect(typeDef).toContain("email: string");
      expect(typeDef).toContain("phone?: string | null");
    });

    test("should use Date | string instead of Timestamp for date fields inside nested objects", async () => {
      const type = db.type("Receipt", {
        receiptDate: db.date(),
        dueSchedule: db.object({
          dueDate: db.date(),
          reminderAt: db.datetime({ optional: true }),
        }),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.typeDef).toContain("receiptDate: string;");
      // Nested object with datetime is wrapped in ObjectColumnType
      expect(result.typeDef).toContain("ObjectColumnType<");
      expect(result.typeDef).toContain("dueDate: string");
      expect(result.typeDef).toContain("reminderAt?: Timestamp | null");
      expect(result.usedUtilityTypes.Timestamp).toBe(true);
    });

    test("should wrap nested object arrays with ArrayColumnType<ObjectColumnType<>>", async () => {
      const typeDef = await getTypeDef(
        db.type("Profile", {
          metadata: db.object(
            {
              created: db.datetime(),
              version: db.int(),
            },
            { array: true },
          ),
        }),
      );

      expect(typeDef).toContain("ArrayColumnType<ObjectColumnType<");
      expect(typeDef).toContain("created: Timestamp");
      expect(typeDef).toContain("version: number");
    });

    test("should handle optional nested object arrays", async () => {
      const typeDef = await getTypeDef(
        db.type("Profile", {
          tags: db.object(
            {
              name: db.string(),
              value: db.string({ optional: true }),
            },
            { array: true, optional: true },
          ),
        }),
      );

      expect(typeDef).toContain("ArrayColumnType<ObjectColumnType<");
      expect(typeDef).toContain("| null");
    });

    test("should use plain array syntax for nested objects without ColumnType fields", async () => {
      const typeDef = await getTypeDef(
        db.type("Profile", {
          tags: db.object(
            {
              name: db.string(),
              value: db.string(),
            },
            { array: true },
          ),
        }),
      );

      // Plain object (no Timestamp/optional fields) uses regular array syntax
      expect(typeDef).toContain("}[];");
      expect(typeDef).not.toContain("ArrayColumnType");
    });

    test("should handle optional nested objects", async () => {
      const typeDef = await getTypeDef(
        db.type("User", {
          settings: db.object(
            {
              theme: db.string(),
              notifications: db.bool(),
            },
            { optional: true },
          ),
        }),
      );

      expect(typeDef).toContain("settings:");
      expect(typeDef).toContain("| null");
    });
  });

  describe("special fields", () => {
    test("should process timestamp fields through normal field processing", async () => {
      const typeWithTimestamps = db.type("UserWithTimestamp", {
        name: db.string(),
        ...db.fields.timestamps(),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(typeWithTimestamps)));

      expect(result.name).toBe("UserWithTimestamp");
      expect(result.typeDef).toContain("UserWithTimestamp: {");
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("createdAt: Generated<Timestamp>;");
      expect(result.typeDef).toContain("updatedAt: Generated<Timestamp>;");
    });

    test("should always include Generated<string> for id field", async () => {
      const typeDef = await getTypeDef(
        db.type("User", {
          name: db.string(),
        }),
      );

      expect(typeDef).toContain("id: Generated<string>;");
    });

    test.each([
      {
        name: "basic types only",
        type: db.type("User", { name: db.string(), age: db.int() }),
        timestamp: false,
        serial: false,
      },
      {
        name: "Timestamp",
        type: db.type("User", { name: db.string(), ...db.fields.timestamps() }),
        timestamp: true,
        serial: false,
      },
      {
        name: "Serial",
        type: db.type("Invoice", { invoiceNumber: db.string().serial({ start: 1000 }) }),
        timestamp: false,
        serial: true,
      },
      {
        name: "both",
        type: db.type("Order", {
          orderNumber: db.string().serial({ start: 1000 }),
          ...db.fields.timestamps(),
        }),
        timestamp: true,
        serial: true,
      },
    ])("should correctly track used utility types - $name", async ({ type, timestamp, serial }) => {
      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.usedUtilityTypes.Timestamp).toBe(timestamp);
      expect(result.usedUtilityTypes.Serial).toBe(serial);
    });
  });
});

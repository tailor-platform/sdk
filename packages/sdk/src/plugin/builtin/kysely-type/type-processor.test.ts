import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import {
  generateKyselyTypesSource,
  generateUnifiedKyselyTypes,
  processKyselyFields,
  processKyselyType,
} from "./type-processor";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

function parseTailorDBType(type: TailorDBTypeSchemaOutput): TailorDBType {
  const types = parseTypes({ [type.name]: type }, "test", {});
  return types[type.name]!;
}

async function getTypeDef(type: TailorAnyDBType, temporal = false) {
  const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)), { temporal });
  return result.typeDef;
}

describe("generateKyselyTypesSource", () => {
  test("exports getDB over no namespaces when no table is defined, so importing it still type-checks", async () => {
    const source = await generateKyselyTypesSource([{ namespace: "main", tables: {} }], {
      temporal: false,
    });

    expect(source).toContain("export interface Namespace {}");
    expect(source).toContain("export const getDB = createGetDB<Namespace>();");
  });
});

describe("Kysely TypeProcessor", () => {
  describe("basic types", () => {
    test("should propagate the type name into the result", async () => {
      const type = db.table("User", {
        name: db.string(),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.name).toBe("User");
    });

    test("preserves the string fallback for legacy number fields", () => {
      const result = processKyselyFields("Metric", {
        value: { type: "number", required: true },
      });

      expect(result.typeDef).toContain("value: string;");
    });

    test.each([
      {
        name: "string types",
        type: db.table("User", {
          name: db.string(),
          nickname: db.string({ optional: true }),
        }),
        expected: ["name: string;", "nickname: string | null;"],
      },
      {
        name: "number types",
        type: db.table("Product", {
          quantity: db.int(),
          price: db.float(),
          discount: db.float({ optional: true }),
        }),
        expected: ["quantity: number;", "price: number;", "discount: number | null;"],
      },
      {
        name: "boolean types",
        type: db.table("Feature", {
          enabled: db.bool(),
          beta: db.bool({ optional: true }),
        }),
        expected: ["enabled: boolean;", "beta: boolean | null;"],
      },
      {
        name: "date and datetime types",
        type: db.table("Event", {
          startDate: db.date(),
          endDate: db.datetime(),
          cancelledAt: db.datetime({ optional: true }),
        }),
        expected: [
          "startDate: Timestamp;",
          "endDate: Timestamp;",
          "cancelledAt: Timestamp | null;",
        ],
      },
      {
        name: "uuid types",
        type: db.table("Session", {
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
        db.table("Post", {
          tags: db.string({ array: true }),
          scores: db.int({ array: true, optional: true }),
        }),
      );

      expect(typeDef).toContain("tags: string[];");
      expect(typeDef).toContain("scores: number[] | null;");
    });

    test("should use ArrayColumnType for datetime array fields", async () => {
      const typeDef = await getTypeDef(
        db.table("Event", {
          eventDates: db.datetime({ array: true }),
          optionalDates: db.date({ array: true, optional: true }),
        }),
      );

      expect(typeDef).toContain("eventDates: ArrayColumnType<Timestamp>;");
      expect(typeDef).toContain("optionalDates: ArrayColumnType<Timestamp> | null;");
    });
  });

  describe("temporal option", () => {
    test("maps date/datetime/time to their Temporal column types", async () => {
      const typeDef = await getTypeDef(
        db.table("Event", {
          startDate: db.date(),
          endDate: db.datetime(),
          startTime: db.time(),
        }),
        true,
      );

      expect(typeDef).toContain("startDate: TemporalDate;");
      expect(typeDef).toContain("endDate: TemporalInstant;");
      expect(typeDef).toContain("startTime: TemporalTime;");
    });

    test("leaves date/datetime/time as Timestamp/string when false (the default)", async () => {
      const typeDef = await getTypeDef(
        db.table("Event", {
          startDate: db.date(),
          endDate: db.datetime(),
          startTime: db.time(),
        }),
      );

      expect(typeDef).toContain("startDate: Timestamp;");
      expect(typeDef).toContain("endDate: Timestamp;");
      expect(typeDef).toContain("startTime: string;");
    });

    test("uses ArrayColumnType for Temporal array fields", async () => {
      const typeDef = await getTypeDef(
        db.table("Event", {
          eventDates: db.datetime({ array: true }),
          optionalTimes: db.time({ array: true, optional: true }),
        }),
        true,
      );

      expect(typeDef).toContain("eventDates: ArrayColumnType<TemporalInstant>;");
      expect(typeDef).toContain("optionalTimes: ArrayColumnType<TemporalTime> | null;");
    });

    test("keeps a nested time field as a string", async () => {
      const typeDef = await getTypeDef(
        db.table("Profile", {
          schedule: db.object({ startTime: db.time() }),
        }),
        true,
      );

      expect(typeDef).toContain("schedule: {");
      expect(typeDef).toContain("startTime: string;");
    });

    test("tracks the Temporal utility types actually used", async () => {
      const result = await processKyselyType(
        parseTailorDBType(
          toSchemaOutput(
            db.table("Event", {
              startDate: db.date(),
              endDate: db.datetime(),
              startTime: db.time(),
            }),
          ),
        ),
        { temporal: true },
      );

      expect(result.usedUtilityTypes).toEqual({
        Timestamp: false,
        TemporalDate: true,
        TemporalInstant: true,
        TemporalTime: true,
        DecimalValue: false,
        Serial: false,
        ObjectColumnType: false,
        ArrayColumnType: false,
      });
    });
  });

  describe("decimal option", () => {
    const table = db.table("Item", {
      price: db.decimal(),
      discount: db.decimal({ optional: true }),
      history: db.decimal({ array: true }),
      meta: db.object({ cost: db.decimal() }),
    });

    async function typeDefWith(decimal: boolean) {
      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(table)), {
        decimal,
      });
      return result;
    }

    test("maps decimal fields to DecimalValue, including nullable and array ones", async () => {
      const { typeDef } = await typeDefWith(true);

      expect(typeDef).toContain("price: DecimalValue;");
      expect(typeDef).toContain("discount: DecimalValue | null;");
      expect(typeDef).toContain("history: ArrayColumnType<DecimalValue>;");
    });

    test("keeps a decimal field inside an object a string, which the runtime cannot convert", async () => {
      const { typeDef } = await typeDefWith(true);

      expect(typeDef).toContain("cost: string;");
      expect(typeDef).not.toContain("ObjectColumnType<");
    });

    test("leaves decimal fields as strings when false (the default)", async () => {
      const { typeDef, usedUtilityTypes } = await typeDefWith(false);

      expect(typeDef).toContain("price: string;");
      expect(typeDef).not.toContain("DecimalValue");
      expect(usedUtilityTypes.DecimalValue).toBe(false);
    });

    test("tracks DecimalValue as a used utility type", async () => {
      expect((await typeDefWith(true)).usedUtilityTypes.DecimalValue).toBe(true);
    });

    test("generates a getDB that reads the same Decimal class the tables are typed with", async () => {
      const source = generateUnifiedKyselyTypes(
        [{ namespace: "main", types: [await typeDefWith(true)] }],
        { decimal: true },
      );

      expect(source).toContain("type DecimalValue,");
      expect(source).toContain('import { Decimal } from "@tailor-platform/sdk/runtime";');
      expect(source).toContain(
        "export const getDB = createGetDB<Namespace>({ decimal: Decimal });",
      );
    });

    test("passes temporal and decimal together", async () => {
      const source = generateUnifiedKyselyTypes([], { temporal: true, decimal: true });

      expect(source).toContain(
        "export const getDB = createGetDB<Namespace>({ temporal: true, decimal: Decimal });",
      );
    });

    test("leaves the generated file exactly as before when the option is off", async () => {
      const source = generateUnifiedKyselyTypes([], {});

      expect(source).toContain(
        '} from "@tailor-platform/sdk/kysely";\n\nexport interface Namespace {}',
      );
    });

    test("imports no Decimal when the option is off", async () => {
      const source = generateUnifiedKyselyTypes(
        [{ namespace: "main", types: [await typeDefWith(false)] }],
        {},
      );

      expect(source).not.toContain("Decimal");
    });
  });

  describe("enum types", () => {
    test("should handle enum types", async () => {
      const typeDef = await getTypeDef(
        db.table("User", {
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
        db.table("Article", {
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
      const simpleNestedType = db.table("SimpleUser", {
        profile: db.object({
          name: db.string(),
          email: db.string({ optional: true }),
        }),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(simpleNestedType)));

      expect(result.name).toBe("SimpleUser");
      expect(result.typeDef).toContain("SimpleUser: ");
      expect(result.typeDef).toContain("profile:");
      expect(result.typeDef).not.toContain("ObjectColumnType<");
      expect(result.typeDef).toContain("name: string");
      expect(result.typeDef).toContain("email?: string | null");
    });

    test("should handle multi-level nested objects", async () => {
      const deepNestedType = db.table("Company", {
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

      expect(typeDef).not.toContain("ObjectColumnType");
      expect(typeDef).toContain("details:");
      expect(typeDef).toContain("address:");
      expect(typeDef).toContain("street: string");
      expect(typeDef).toContain("city: string");
      expect(typeDef).toContain("zipCode?: string | null");
      expect(typeDef).toContain("contact:");
      expect(typeDef).toContain("email: string");
      expect(typeDef).toContain("phone?: string | null");
    });

    test("should use Timestamp for date fields inside nested objects", async () => {
      const type = db.table("Receipt", {
        receiptDate: db.date(),
        dueSchedule: db.object({
          dueDate: db.date(),
          reminderAt: db.datetime({ optional: true }),
        }),
      });

      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.typeDef).toContain("receiptDate: Timestamp;");
      // Nested object with datetime is wrapped in ObjectColumnType
      expect(result.typeDef).toContain("ObjectColumnType<");
      expect(result.typeDef).toContain("dueDate: Timestamp");
      expect(result.typeDef).toContain("reminderAt?: Timestamp | null");
      expect(result.usedUtilityTypes.Timestamp).toBe(true);
    });

    test("should wrap nested object arrays with ArrayColumnType<ObjectColumnType<>>", async () => {
      const typeDef = await getTypeDef(
        db.table("Profile", {
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
        db.table("Profile", {
          tags: db.object(
            {
              name: db.string(),
              value: db.string({ optional: true }),
            },
            { array: true, optional: true },
          ),
        }),
      );

      expect(typeDef).not.toContain("ColumnType");
      expect(typeDef).toContain("value?: string | null");
      expect(typeDef).toContain("}[] | null;");
    });

    test("should use plain array syntax for nested objects without ColumnType fields", async () => {
      const typeDef = await getTypeDef(
        db.table("Profile", {
          tags: db.object(
            {
              name: db.string(),
              value: db.string(),
            },
            { array: true },
          ),
        }),
      );

      expect(typeDef).toContain("}[];");
      expect(typeDef).not.toContain("ArrayColumnType");
    });

    test("should handle optional nested objects", async () => {
      const typeDef = await getTypeDef(
        db.table("User", {
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
      const typeWithTimestamps = db.table("UserWithTimestamp", {
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

    test("should wrap fields with default in Generated<>", async () => {
      const typeDef = await getTypeDef(
        db.table("Order", {
          status: db.string().default("pending"),
          priority: db.int(),
        }),
      );

      expect(typeDef).toContain("status: Generated<string>;");
      expect(typeDef).toContain("priority: number;");
    });

    test("should always include Generated<string> for id field", async () => {
      const typeDef = await getTypeDef(
        db.table("User", {
          name: db.string(),
        }),
      );

      expect(typeDef).toContain("id: Generated<string>;");
    });

    test.each([
      {
        name: "basic types only",
        type: db.table("User", { name: db.string(), age: db.int() }),
        expected: {
          Timestamp: false,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: false,
          ObjectColumnType: false,
          ArrayColumnType: false,
        },
      },
      {
        name: "Timestamp",
        type: db.table("User", { name: db.string(), ...db.fields.timestamps() }),
        expected: {
          Timestamp: true,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: false,
          ObjectColumnType: false,
          ArrayColumnType: false,
        },
      },
      {
        name: "Serial",
        type: db.table("Invoice", { invoiceNumber: db.string().serial({ start: 1000 }) }),
        expected: {
          Timestamp: false,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: true,
          ObjectColumnType: false,
          ArrayColumnType: false,
        },
      },
      {
        name: "both",
        type: db.table("Order", {
          orderNumber: db.string().serial({ start: 1000 }),
          ...db.fields.timestamps(),
        }),
        expected: {
          Timestamp: true,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: true,
          ObjectColumnType: false,
          ArrayColumnType: false,
        },
      },
      {
        name: "ObjectColumnType",
        type: db.table("User", {
          profile: db.object({ createdAt: db.datetime() }),
        }),
        expected: {
          Timestamp: true,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: false,
          ObjectColumnType: true,
          ArrayColumnType: false,
        },
      },
      {
        name: "ArrayColumnType",
        type: db.table("Event", { eventDates: db.datetime({ array: true }) }),
        expected: {
          Timestamp: true,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: false,
          ObjectColumnType: false,
          ArrayColumnType: true,
        },
      },
      {
        name: "ArrayColumnType wrapping ObjectColumnType",
        type: db.table("Profile", {
          metadata: db.object({ created: db.datetime() }, { array: true }),
        }),
        expected: {
          Timestamp: true,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: false,
          ObjectColumnType: true,
          ArrayColumnType: true,
        },
      },
      {
        name: "enum values naming the wrappers",
        type: db.table("Status", {
          kind: db.enum([
            { value: "ObjectColumnType<Timestamp>" },
            { value: "ArrayColumnType<Timestamp>" },
          ]),
        }),
        expected: {
          Timestamp: false,
          TemporalDate: false,
          TemporalInstant: false,
          TemporalTime: false,
          DecimalValue: false,
          Serial: false,
          ObjectColumnType: false,
          ArrayColumnType: false,
        },
      },
    ])("should correctly track used utility types - $name", async ({ type, expected }) => {
      const result = await processKyselyType(parseTailorDBType(toSchemaOutput(type)));

      expect(result.usedUtilityTypes).toEqual(expected);
    });
  });
});

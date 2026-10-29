import { describe, expect, test } from "vitest";
import { createSnapshotType } from "#/cli/commands/tailordb/migrate/snapshot-local";
import { convertFieldConfigToProto } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { platformSchemaOf } from "./platform-schema";

const customer = db.table("Customer", { name: db.string() });

const order = db.table("Order", {
  customerID: db.uuid().relation({ type: "n-1", toward: { table: customer } }),
  status: db.enum(["PENDING", "PAID"]),
  note: db.string({ optional: true }).vector(),
  code: db.int({ optional: true }).unique(),
  tags: db.string({ optional: true, array: true }),
  shipping: db.object({ city: db.string(), zip: db.string({ optional: true }) }),
  paid: db.bool(),
  weight: db.float({ optional: true }),
  total: db.decimal({ scale: 2 }),
  orderDate: db.date(),
  paidAt: db.datetime({ optional: true }),
  deliveryTime: db.time({ optional: true }),
});

const [parsedOrder] = Object.values(
  parseTypes({ Order: toSchemaOutput(order), Customer: toSchemaOutput(customer) }, "main", {}),
).filter((table) => table.name === "Order");

const field = (type: string, extra: Record<string, unknown> = {}) => ({
  _type: type,
  _required: true,
  _array: false,
  _unique: false,
  _vector: false,
  _foreignKey: false,
  ...extra,
});

describe("platformSchemaOf", () => {
  test("writes each table as TailorDB stores its type, without id", () => {
    expect(platformSchemaOf([parsedOrder!])).toEqual({
      Order: {
        _settings: { publishRecordEvents: false },
        fields: {
          customerID: field("uuid"),
          status: field("enum", { _allowedValues: [{ value: "PENDING" }, { value: "PAID" }] }),
          note: field("string", { _required: false, _vector: true }),
          code: field("integer", { _required: false, _unique: true }),
          tags: field("string", { _required: false, _array: true }),
          shipping: field("nested", {
            fields: { city: field("string"), zip: field("string", { _required: false }) },
          }),
          paid: field("boolean"),
          weight: field("float", { _required: false }),
          total: field("decimal"),
          orderDate: field("date"),
          paidAt: field("datetime", { _required: false }),
          deliveryTime: field("time", { _required: false }),
        },
      },
    });
  });

  test("agrees with what deploy sends TailorDB for each attribute it writes", () => {
    const snapshot = createSnapshotType(parsedOrder!);
    const { fields } = platformSchemaOf([parsedOrder!]).Order!;
    const written = Object.entries(fields).map(([name, field]) => ({
      name,
      type: field._type,
      required: field._required,
      array: field._array,
      unique: field._unique,
      vector: field._vector,
      allowedValues: field._allowedValues?.map((v) => v.value) ?? [],
      fields: Object.keys(field.fields ?? {}),
    }));
    const sent = Object.keys(fields).map((name) => {
      const field = convertFieldConfigToProto(snapshot.fields[name]!);
      return {
        name,
        type: field.type,
        required: field.required,
        array: field.array,
        unique: field.unique,
        vector: field.vector,
        allowedValues: field.allowedValues?.map((v) => v.value),
        fields: Object.keys(field.fields ?? {}),
      };
    });

    expect(written).toEqual(sent);
  });
});

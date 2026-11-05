import { describe, expect, test } from "vitest";
import { buildRecordMeta, fieldSelections } from "./crud";

const field = (type: string, fields?: Record<string, unknown>, extra: object = {}) => ({
  name: "",
  config: { type, ...(fields && { fields }), ...extra },
});

describe("fieldSelections", () => {
  test("selects each field of the type by its name, in the order they are declared", () => {
    const selections = fieldSelections({
      id: field("uuid"),
      status: field("enum"),
      orderDate: field("date"),
    } as never);

    expect(selections).toEqual({ id: "id", status: "status", orderDate: "orderDate" });
  });

  test("selects a nested object together with the fields inside it", () => {
    const selections = fieldSelections({
      id: field("uuid"),
      address: field("nested", {
        city: { type: "string" },
        geo: { type: "nested", fields: { lat: { type: "float" } } },
      }),
    } as never);

    expect(selections).toEqual({ id: "id", address: "address { city geo { lat } }" });
  });
});

const relation = (name: string, targetType: string, isArray: boolean) => ({
  name,
  targetType,
  targetField: "",
  sourceField: "id",
  isArray,
  description: "",
});

function typeOf(
  name: string,
  pluralForm: string,
  fields: Record<string, unknown>,
  relations: { forward?: object; backward?: object } = {},
) {
  return {
    name,
    pluralForm,
    fields,
    forwardRelationships: relations.forward ?? {},
    backwardRelationships: relations.backward ?? {},
  } as never;
}

const CUSTOMER = typeOf("Customer", "Customers", { id: field("uuid"), name: field("string") });
const ORDER = typeOf(
  "Order",
  "Orders",
  {
    id: field("uuid"),
    status: field("enum"),
    address: field("nested", { city: { type: "string" } }),
  },
  { forward: { customer: relation("customer", "Customer", false) } },
);

describe("buildRecordMeta", () => {
  test("names the type and its root fields the way the platform generates them", () => {
    const meta = buildRecordMeta(
      typeOf("product_bundle", "ProductBundles", { id: field("uuid") }),
      {},
    );

    expect([meta.typeName, meta.one, meta.many]).toEqual([
      "ProductBundle",
      "productBundle",
      "productBundles",
    ]);
  });

  test("selects each field of the type", () => {
    expect(buildRecordMeta(ORDER, {}).fields).toEqual({
      id: "id",
      status: "status",
      address: "address { city }",
    });
  });

  test("marks a type with a field to sort by as sortable", () => {
    expect(buildRecordMeta(ORDER, {}).sortable).toBe(true);
  });

  test("leaves a type with no field to sort by unsortable", () => {
    const meta = buildRecordMeta(
      typeOf("Tag", "Tags", {
        id: field("uuid"),
        meta: field("nested", { a: { type: "string" } }),
      }),
      {},
    );

    expect(meta.sortable).toBe(false);
  });

  test("describes a relation by the type it points to, and whether it points to many", () => {
    const customer = typeOf(
      "Customer",
      "Customers",
      { id: field("uuid"), name: field("string") },
      { backward: { orders: relation("orders", "Order", true) } },
    );

    expect(buildRecordMeta(ORDER, { Customer: CUSTOMER }).relations).toEqual({
      customer: {
        typeName: "Customer",
        fields: { id: "id", name: "name" },
        sortable: true,
        many: false,
      },
    });
    expect(buildRecordMeta(customer, { Order: ORDER }).relations).toEqual({
      orders: {
        typeName: "Order",
        fields: { id: "id", status: "status", address: "address { city }" },
        sortable: true,
        many: true,
      },
    });
  });

  test("leaves out a relation to a type the project does not define", () => {
    expect(buildRecordMeta(ORDER, {}).relations).toEqual({});
  });
});

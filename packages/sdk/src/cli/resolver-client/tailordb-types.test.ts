import { describe, expect, test } from "vitest";
import { filterKinds, listTailorDBTypes, renderTailorDBDeclarations } from "./tailordb-types";

const NONE = { forwardRelationships: {}, backwardRelationships: {} };
const ORDER = { name: "Order", pluralForm: "Orders", fields: {}, ...NONE };
const INVOICE = { name: "Invoice", pluralForm: "Invoices", fields: {}, ...NONE };

function namespace(sources: Record<string, unknown>, tables: Record<string, unknown>) {
  return { namespace: "main", tables, sourceInfo: new Map(Object.entries(sources)) } as never;
}

describe("listTailorDBTypes", () => {
  test("lists each type with the file and export that define it", () => {
    const entries = listTailorDBTypes([
      namespace(
        { Order: { filePath: "/app/tailordb/order.ts", exportName: "order" } },
        { Order: ORDER },
      ),
    ]);

    expect(entries).toEqual([
      { name: "Order", file: "/app/tailordb/order.ts", exportName: "order", type: ORDER },
    ]);
  });

  test("leaves out a type a plugin generated, which has no file to import its type from", () => {
    const entries = listTailorDBTypes([
      namespace(
        {
          Order: { filePath: "/app/tailordb/order.ts", exportName: "order" },
          Invoice: { exportName: "invoice", pluginId: "some-plugin" },
        },
        { Order: ORDER, Invoice: INVOICE },
      ),
    ]);

    expect(entries.map((entry) => entry.name)).toEqual(["Order"]);
  });
});

describe("renderTailorDBDeclarations", () => {
  const entries = [
    { name: "Order", file: "/app/tailordb/order.ts", exportName: "order", type: ORDER },
  ] as never;

  test("derives the record type of each type from the definition that declares it", () => {
    const text = renderTailorDBDeclarations(entries);

    expect(text).toContain('import type { order as definition0 } from "/app/tailordb/order";');
    expect(text).toContain(
      "declare const crud0: TailorDBRecords<RecordOf<typeof definition0>, Kinds0>;",
    );
  });

  test("exports the operations of each type under the type's name", () => {
    expect(renderTailorDBDeclarations(entries)).toContain('export { crud0 as "Order" };');
  });

  test("offers select on get and list, which narrows the record to the fields picked", () => {
    const text = renderTailorDBDeclarations(entries);

    expect(text).toContain("options?: { select?: S; include?: I }");
    expect(text).toContain("args?: ManyOptions<R, Kinds> & { select?: S; include?: I }");
    expect(text).toContain("Promise<WithIncluded<Picked<R, S>, Rel, I> | null>");
  });

  test("lets an included relation pick its own fields", () => {
    const text = renderTailorDBDeclarations(entries);

    expect(text).toContain(
      "type RelationOptions<Rec, Kinds, Many extends boolean> = { select?: SelectOf<Rec> }",
    );
  });

  test("declares the operators of each kind of field the way the platform filters it", () => {
    const text = renderTailorDBDeclarations(entries);

    expect(text).toContain("type Compare<V> = { gt?: V; gte?: V; lt?: V; lte?: V;");
    expect(text).toContain('K extends "bool" ? Equal<V>');
    expect(text).toContain('K extends "number" | "ordered" ? Member<V> & Compare<NonNullable<V>>');
    expect(text).toContain('K extends "text" ? Member<V> & TextOperators');
    expect(text).toContain("len?: ArrayLength; has?:");
    for (const operator of [
      "contains",
      "notContains",
      "hasPrefix",
      "hasSuffix",
      "notHasPrefix",
      "notHasSuffix",
      "regex",
    ]) {
      expect(text).toContain(`${operator}?: string`);
    }
  });

  test("filters the fields of a type by the kinds of its fields", () => {
    expect(renderTailorDBDeclarations(entries)).toContain(
      "declare const crud0: TailorDBRecords<RecordOf<typeof definition0>, Kinds0>;",
    );
  });

  test("declares the operations every type offers", () => {
    const text = renderTailorDBDeclarations(entries);

    for (const operation of ["get<", "list<", "create(", "update(", "delete("]) {
      expect(text).toContain(operation);
    }
  });
});

describe("renderTailorDBDeclarations with relations", () => {
  const relation = (name: string, targetType: string, isArray: boolean, targetField = "") => ({
    name,
    targetType,
    targetField,
    sourceField: "id",
    isArray,
    description: "",
  });
  const customer = {
    name: "Customer",
    pluralForm: "Customers",
    fields: {},
    forwardRelationships: {},
    backwardRelationships: { orders: relation("orders", "Order", true) },
  };
  const order = {
    name: "Order",
    pluralForm: "Orders",
    fields: { customerID: { config: { type: "uuid", required: true } } },
    forwardRelationships: { customer: relation("customer", "Customer", false, "customerID") },
    backwardRelationships: { invoice: relation("invoice", "Invoice", false) },
  };
  const entries = [
    { name: "Order", file: "/app/order.ts", exportName: "order", type: order },
    { name: "Customer", file: "/app/customer.ts", exportName: "customer", type: customer },
    { name: "Invoice", file: "/app/invoice.ts", exportName: "invoice", type: INVOICE },
  ] as never;

  test("types a relation by the record it points to", () => {
    const text = renderTailorDBDeclarations(entries);

    expect(text).toContain(
      "declare const crud0: TailorDBRecords<RecordOf<typeof definition0>, Kinds0, { " +
        "customer: { record: RecordOf<typeof definition1>; kinds: Kinds1; many: false; nullable: false }; " +
        "invoice: { record: RecordOf<typeof definition2>; kinds: Kinds2; many: false; nullable: true } }>;",
    );
    expect(text).toContain(
      "declare const crud1: TailorDBRecords<RecordOf<typeof definition1>, Kinds1, { " +
        "orders: { record: RecordOf<typeof definition0>; kinds: Kinds0; many: true; nullable: false } }>;",
    );
  });

  test("makes a many-to-one relation nullable when the foreign key is optional", () => {
    const optional = {
      ...order,
      fields: { customerID: { config: { type: "uuid", required: false } } },
      backwardRelationships: {},
    };

    const text = renderTailorDBDeclarations([
      { name: "Order", file: "/app/order.ts", exportName: "order", type: optional },
      { name: "Customer", file: "/app/customer.ts", exportName: "customer", type: customer },
    ] as never);

    expect(text).toContain(
      "customer: { record: RecordOf<typeof definition1>; kinds: Kinds1; many: false; nullable: true }",
    );
  });

  test("leaves out a relation to a type the project does not define", () => {
    const text = renderTailorDBDeclarations([
      { name: "Order", file: "/app/order.ts", exportName: "order", type: order },
    ] as never);

    expect(text).toContain(
      "declare const crud0: TailorDBRecords<RecordOf<typeof definition0>, Kinds0>;",
    );
  });
});

describe("filterKinds", () => {
  const field = (type: string, extra: object = {}) => ({ config: { type, ...extra } });

  test("tells the fields apart by how the platform filters them", () => {
    const kinds = filterKinds({
      id: field("uuid"),
      title: field("string"),
      done: field("boolean"),
      count: field("integer"),
      ratio: field("float"),
      price: field("decimal"),
      status: field("enum"),
      day: field("date"),
      at: field("datetime"),
      starts: field("time"),
    } as never);

    expect(kinds).toBe(
      '{ "id": "uuid"; "title": "text"; "done": "bool"; "count": "number"; "ratio": "number"; ' +
        '"price": "number"; "status": "enum"; "day": "ordered"; "at": "ordered"; "starts": "ordered" }',
    );
  });

  test("marks an array of a kind by a tuple of that kind", () => {
    expect(filterKinds({ tags: field("string", { array: true }) } as never)).toBe(
      '{ "tags": ["text"] }',
    );
  });

  test("describes a nested object by the kinds of the fields inside it", () => {
    const kinds = filterKinds({
      address: field("nested", { fields: { city: { type: "string" }, zip: { type: "integer" } } }),
    } as never);

    expect(kinds).toBe('{ "address": { "city": "text"; "zip": "number" } }');
  });

  test("leaves an array of nested objects unfilterable", () => {
    const kinds = filterKinds({
      lines: field("nested", { array: true, fields: { sku: { type: "string" } } }),
    } as never);

    expect(kinds).toBe('{ "lines": "none" }');
  });
});

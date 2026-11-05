import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRecords, type RecordTypeMeta } from "./records";
import { resetResolverClient } from "./state";
import { configureResolvers } from "./index";

const ORDER: RecordTypeMeta = {
  typeName: "Order",
  one: "order",
  many: "orders",
  fields: { id: "id", amount: "amount" },
  sortable: true,
  relations: {
    customer: {
      typeName: "Customer",
      fields: { id: "id", name: "name" },
      sortable: true,
      many: false,
    },
    items: { typeName: "Item", fields: { id: "id", sku: "sku" }, sortable: true, many: true },
    notes: { typeName: "Note", fields: { id: "id", body: "body" }, sortable: false, many: true },
  },
};

function serve(data: unknown) {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data }));
  configureResolvers({ url: "https://app.erp.dev", fetch: fetcher });
  const sent = () =>
    JSON.parse(fetcher.mock.calls.at(-1)?.[1]?.body as string) as {
      query: string;
      variables?: Record<string, unknown>;
    };
  return { sent };
}

describe("createRecords", () => {
  beforeEach(() => {
    resetResolverClient();
  });

  describe("get", () => {
    test("gets a record by id with the fields of the type", async () => {
      const { sent } = serve({ order: { id: "o1", amount: 3 } });

      const record = await createRecords(ORDER).get("o1");

      expect(record).toEqual({ id: "o1", amount: 3 });
      expect(sent()).toEqual({
        query: "query order($id: ID!) { order(id: $id) { id amount } }",
        variables: { id: "o1" },
      });
    });

    test("returns null for a record that does not exist", async () => {
      serve({ order: null });

      expect(await createRecords(ORDER).get("missing")).toBeNull();
    });

    test("includes the record a relation points to", async () => {
      const { sent } = serve({
        order: { id: "o1", amount: 3, customer: { id: "c1", name: "Ada" } },
      });

      const record = await createRecords(ORDER).get("o1", { include: { customer: true } });

      expect(record).toEqual({ id: "o1", amount: 3, customer: { id: "c1", name: "Ada" } });
      expect(sent().query).toBe(
        "query order($id: ID!) { order(id: $id) { id amount customer { id name } } }",
      );
    });

    test("includes the records of a one-to-many relation as an array, passing its paging and order along", async () => {
      const { sent } = serve({
        order: {
          id: "o1",
          amount: 3,
          items: { edges: [{ node: { id: "i1", sku: "a" } }, { node: { id: "i2", sku: "b" } }] },
        },
      });
      const order = [{ field: "sku", direction: "Asc" }];

      const record = await createRecords(ORDER).get("o1", {
        include: { items: { first: 5, order } },
      });

      expect(record).toEqual({
        id: "o1",
        amount: 3,
        items: [
          { id: "i1", sku: "a" },
          { id: "i2", sku: "b" },
        ],
      });
      expect(sent()).toEqual({
        query:
          "query order($id: ID!, $items_first: Int, $items_order: [ItemOrderInput]) " +
          "{ order(id: $id) { id amount items(first: $items_first, order: $items_order) { edges { node { id sku } } } } }",
        variables: { id: "o1", items_first: 5, items_order: order },
      });
    });

    test("includes a one-to-many relation without arguments when given true", async () => {
      const { sent } = serve({ order: { id: "o1", amount: 3, items: { edges: [] } } });

      const record = await createRecords(ORDER).get("o1", { include: { items: true } });

      expect(record).toEqual({ id: "o1", amount: 3, items: [] });
      expect(sent().query).toBe(
        "query order($id: ID!) { order(id: $id) { id amount items { edges { node { id sku } } } } }",
      );
    });

    test("selects only the fields given, in the order the type declares them", async () => {
      const { sent } = serve({ order: { id: "o1", amount: 3 } });

      await createRecords(ORDER).get("o1", { select: { amount: true, id: true } });

      expect(sent().query).toBe("query order($id: ID!) { order(id: $id) { id amount } }");
    });

    test("selects only the field asked for", async () => {
      const { sent } = serve({ order: { amount: 3 } });

      const record = await createRecords(ORDER).get("o1", { select: { amount: true } });

      expect(record).toEqual({ amount: 3 });
      expect(sent().query).toBe("query order($id: ID!) { order(id: $id) { amount } }");
    });

    test("selects only the fields given of an included record", async () => {
      const { sent } = serve({ order: { id: "o1", amount: 3, customer: { name: "Ada" } } });

      await createRecords(ORDER).get("o1", {
        include: { customer: { select: { name: true } } },
      });

      expect(sent().query).toBe(
        "query order($id: ID!) { order(id: $id) { id amount customer { name } } }",
      );
    });

    test("selects only the fields given of the records of a one-to-many relation, along with its arguments", async () => {
      const { sent } = serve({
        order: { id: "o1", amount: 3, items: { edges: [{ node: { sku: "a" } }] } },
      });

      const record = await createRecords(ORDER).get("o1", {
        select: { id: true },
        include: { items: { select: { sku: true }, first: 2 } },
      });

      expect(record).toEqual({ id: "o1", amount: 3, items: [{ sku: "a" }] });
      expect(sent()).toEqual({
        query:
          "query order($id: ID!, $items_first: Int) " +
          "{ order(id: $id) { id items(first: $items_first) { edges { node { sku } } } } }",
        variables: { id: "o1", items_first: 2 },
      });
    });

    test("rejects a field the type does not have", async () => {
      serve({ order: null });

      await expect(createRecords(ORDER).get("o1", { select: { nope: true } })).rejects.toThrow(
        'Order has no field "nope"',
      );
    });

    test("rejects a field the related type does not have", async () => {
      serve({ order: null });

      await expect(
        createRecords(ORDER).get("o1", { include: { customer: { select: { nope: true } } } }),
      ).rejects.toThrow('Customer has no field "nope"');
    });

    test("rejects a selection that picks no field", async () => {
      serve({ order: null });

      await expect(createRecords(ORDER).get("o1", { select: {} })).rejects.toThrow(
        "select must pick at least one field of Order",
      );
    });

    test("rejects a relation the type does not have", async () => {
      serve({ order: null });

      await expect(createRecords(ORDER).get("o1", { include: { nope: true } })).rejects.toThrow(
        'Order has no relation "nope"',
      );
    });
  });

  describe("list", () => {
    test("lists the nodes of the connection with its page info and total", async () => {
      const { sent } = serve({
        orders: {
          edges: [{ node: { id: "o1", amount: 3 }, cursor: "c" }],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: "c",
            endCursor: "c",
          },
          total: 1,
        },
      });

      const page = await createRecords(ORDER).list({ first: 10 });

      expect(page).toEqual({
        nodes: [{ id: "o1", amount: 3 }],
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: "c", endCursor: "c" },
        total: 1,
      });
      expect(sent()).toEqual({
        query:
          "query orders($query: OrderQueryInput, $first: Int, $after: String, $last: Int, $before: String, $order: [OrderOrderInput]) " +
          "{ orders(query: $query, first: $first, after: $after, last: $last, before: $before, order: $order) " +
          "{ edges { node { id amount } cursor } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } total } }",
        variables: { first: 10 },
      });
    });

    test("leaves out the order argument of a type with no field to sort by", async () => {
      const { sent } = serve({ orders: { edges: [], pageInfo: {}, total: 0 } });

      await createRecords({ ...ORDER, sortable: false }).list();

      expect(sent().query).not.toContain("$order");
    });

    test("selects only the fields given of every node", async () => {
      const { sent } = serve({
        orders: { edges: [{ node: { amount: 3 }, cursor: "c" }], pageInfo: {}, total: 1 },
      });

      const page = await createRecords(ORDER).list({ select: { amount: true } });

      expect(page.nodes).toEqual([{ amount: 3 }]);
      expect(sent().query).toContain("{ edges { node { amount } cursor } pageInfo");
    });

    test("includes relations in every node, flattening the one-to-many ones", async () => {
      const { sent } = serve({
        orders: {
          edges: [
            {
              node: {
                id: "o1",
                amount: 3,
                customer: { id: "c1", name: "Ada" },
                items: { edges: [{ node: { id: "i1", sku: "a" } }] },
              },
              cursor: "c",
            },
          ],
          pageInfo: {},
          total: 1,
        },
      });

      const page = await createRecords(ORDER).list({ include: { customer: true, items: true } });

      expect(page.nodes).toEqual([
        {
          id: "o1",
          amount: 3,
          customer: { id: "c1", name: "Ada" },
          items: [{ id: "i1", sku: "a" }],
        },
      ]);
      expect(sent().query).toContain(
        "node { id amount customer { id name } items { edges { node { id sku } } } }",
      );
    });

    test("leaves out the order argument of a relation whose type has no field to sort by", async () => {
      const { sent } = serve({ order: { id: "o1", amount: 3, notes: { edges: [] } } });

      await createRecords(ORDER).get("o1", { include: { notes: { first: 2 } } });

      expect(sent().query).not.toContain("NoteOrderInput");
    });
  });

  describe("create, update and delete", () => {
    test("creates a record from an input", async () => {
      const { sent } = serve({ createOrder: { id: "o1", amount: 3 } });

      const record = await createRecords(ORDER).create({ amount: 3 });

      expect(record).toEqual({ id: "o1", amount: 3 });
      expect(sent()).toEqual({
        query:
          "mutation createOrder($input: OrderCreateInput!) { createOrder(input: $input) { id amount } }",
        variables: { input: { amount: 3 } },
      });
    });

    test("updates a record by id", async () => {
      const { sent } = serve({ updateOrder: { id: "o1", amount: 4 } });

      await createRecords(ORDER).update("o1", { amount: 4 });

      expect(sent()).toEqual({
        query:
          "mutation updateOrder($id: ID!, $input: OrderUpdateInput!) { updateOrder(id: $id, input: $input) { id amount } }",
        variables: { id: "o1", input: { amount: 4 } },
      });
    });

    test("deletes a record by id and returns whether it was deleted", async () => {
      const { sent } = serve({ deleteOrder: true });

      expect(await createRecords(ORDER).delete("o1")).toBe(true);
      expect(sent()).toEqual({
        query: "mutation deleteOrder($id: ID!) { deleteOrder(id: $id) }",
        variables: { id: "o1" },
      });
    });
  });
});

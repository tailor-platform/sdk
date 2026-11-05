import { describe, expect, test } from "vitest";
import { createResolver, t } from "#/configure/index";
import { ResolverSchema } from "#/parser/service/resolver/index";
import { buildResolverOperation } from "./operation";

function operationOf(definition: unknown) {
  return buildResolverOperation(ResolverSchema.parse(definition));
}

describe("buildResolverOperation", () => {
  test("passes each input key as its own variable and returns a scalar output bare", () => {
    const operation = operationOf(
      createResolver({
        name: "add",
        operation: "query",
        input: { a: t.int(), b: t.int() },
        body: ({ input }) => input.a + input.b,
        output: t.int(),
      }),
    );

    expect(operation).toEqual({
      field: "add",
      document: "query add($a: Int!, $b: Int!) { add(a: $a, b: $b) }",
    });
  });

  test("takes no variables for a resolver without input", () => {
    const operation = operationOf(
      createResolver({
        name: "test",
        operation: "query",
        body: () => true,
        output: t.bool(),
      }),
    );

    expect(operation.document).toBe("query test { test }");
  });

  test("leaves an optional input nullable", () => {
    const operation = operationOf(
      createResolver({
        name: "greet",
        operation: "query",
        input: { name: t.string(), title: t.string({ optional: true }) },
        body: ({ input }) => input.name,
        output: t.string(),
      }),
    );

    expect(operation.document).toBe(
      "query greet($name: String!, $title: String) { greet(name: $name, title: $title) }",
    );
  });

  test("selects every field of an object output, including nested objects", () => {
    const operation = operationOf(
      createResolver({
        name: "stepChain",
        operation: "query",
        body: () => ({ result: { summary: "done" }, count: 1 }),
        output: {
          result: t.object({ summary: t.string() }),
          count: t.int(),
        },
      }),
    );

    expect(operation.document).toBe("query stepChain { stepChain { result { summary } count } }");
  });

  test("sends a mutation as a mutation", () => {
    const operation = operationOf(
      createResolver({
        name: "remove",
        operation: "mutation",
        input: { id: t.uuid() },
        body: () => true,
        output: t.bool(),
      }),
    );

    expect(operation.document).toBe("mutation remove($id: ID!) { remove(id: $id) }");
  });

  test("declares arrays with the element and the list each required or not", () => {
    const operation = operationOf(
      createResolver({
        name: "tag",
        operation: "mutation",
        input: { ids: t.uuid({ array: true }), tags: t.string({ array: true, optional: true }) },
        body: () => true,
        output: t.bool(),
      }),
    );

    expect(operation.document).toBe(
      "mutation tag($ids: [ID!]!, $tags: [String]) { tag(ids: $ids, tags: $tags) }",
    );
  });

  test("types a nested or enum input by the name the resolver is registered with", () => {
    const operation = operationOf(
      createResolver({
        name: "ship",
        operation: "mutation",
        input: {
          address: t.object({ city: t.string() }).typeName("ShippingAddress"),
          status: t.enum(["PAID", "OPEN"]),
        },
        body: () => true,
        output: t.bool(),
      }),
    );

    expect(operation.document).toBe(
      "mutation ship($address: ShippingAddress!, $status: ShipInputStatus!) { ship(address: $address, status: $status) }",
    );
  });
});

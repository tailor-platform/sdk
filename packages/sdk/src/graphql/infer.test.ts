import { describe, it, expectTypeOf } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import type {
  ExtractRootField,
  InferCreateInput,
  InferUpdateInput,
  InferGqlResult,
  GqlVariables,
  GqlResult,
} from "./infer";

// === ExtractRootField ===

describe("ExtractRootField", () => {
  it("extracts field name from mutation with variables declaration", () => {
    type R =
      ExtractRootField<"mutation createFoo($input: FooInput!) { createFoo(input: $input) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"createFoo">();
  });

  it("extracts field name from shorthand mutation", () => {
    type R = ExtractRootField<"mutation { createFoo(input: $input) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"createFoo">();
  });

  it("extracts field name from query with variables declaration", () => {
    type R = ExtractRootField<"query GetSalesOrder($id: ID!) { salesOrder(id: $id) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"salesOrder">();
  });

  it("extracts field name from shorthand query", () => {
    type R = ExtractRootField<"{ salesOrder(id: $id) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"salesOrder">();
  });

  it("extracts field name when no parentheses", () => {
    type R = ExtractRootField<"query { users { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"users">();
  });

  it("handles multiline queries", () => {
    type R = ExtractRootField<`
      mutation createUser($input: UserInput!) {
        createUser(input: $input) {
          id
        }
      }
    `>;
    expectTypeOf<R>().toEqualTypeOf<"createUser">();
  });

  it("handles delete mutation", () => {
    type R = ExtractRootField<"mutation { deleteUser(id: $id) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"deleteUser">();
  });

  it("handles update mutation", () => {
    type R = ExtractRootField<"mutation { updateUser(id: $id, input: $input) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"updateUser">();
  });

  it("falls back to string for non-literal string type", () => {
    type R = ExtractRootField<string>;
    expectTypeOf<R>().toEqualTypeOf<string>();
  });

  it("falls back to string for string without braces", () => {
    type R = ExtractRootField<"no braces here">;
    expectTypeOf<R>().toEqualTypeOf<string>();
  });
});

// === InferCreateInput ===

describe("InferCreateInput", () => {
  it("excludes id field", () => {
    const t = db.type("T", { name: db.string() });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ name: string }>();
  });

  it("maps required fields as required", () => {
    const t = db.type("T", {
      name: db.string(),
      age: db.int(),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ name: string; age: number }>();
  });

  it("maps optional fields as optional with null", () => {
    const t = db.type("T", {
      name: db.string(),
      bio: db.string({ optional: true }),
    });
    type Input = InferCreateInput<typeof t>;
    // Optional fields should have ?:
    expectTypeOf<Input>().toHaveProperty("name");
    expectTypeOf<Input>().toHaveProperty("bio");
    // Required field
    type NameType = Input["name"];
    expectTypeOf<NameType>().toEqualTypeOf<string>();
  });

  it("excludes fields with create hooks (field-level)", () => {
    const t = db.type("T", {
      name: db.string(),
      createdAt: db.datetime().hooks({ create: () => new Date() }),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ name: string }>();
  });

  it("excludes fields with create hooks (type-level)", () => {
    const t = db
      .type("T", {
        name: db.string(),
        createdAt: db.datetime(),
      })
      .hooks({
        createdAt: { create: () => new Date() },
      });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ name: string }>();
  });

  it("excludes serial fields", () => {
    const t = db.type("T", {
      name: db.string(),
      seq: db.int().serial({ start: 1 }),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ name: string }>();
  });

  it("maps enum fields to literal union", () => {
    const t = db.type("T", {
      status: db.enum(["ACTIVE", "INACTIVE"]),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ status: "ACTIVE" | "INACTIVE" }>();
  });

  it("maps boolean fields", () => {
    const t = db.type("T", { active: db.bool() });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ active: boolean }>();
  });

  it("maps date/datetime/time to string", () => {
    const t = db.type("T", {
      birth: db.date(),
      ts: db.datetime(),
      open: db.time(),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{
      birth: string;
      ts: string;
      open: string;
    }>();
  });

  it("maps uuid fields to string", () => {
    const t = db.type("T", { ref: db.uuid() });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ ref: string }>();
  });

  it("maps array fields", () => {
    const t = db.type("T", {
      tags: db.string({ array: true }),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{ tags: string[] }>();
  });

  it("maps nested object fields", () => {
    const t = db.type("T", {
      address: db.object({
        city: db.string(),
        zip: db.string(),
      }),
    });
    type Input = InferCreateInput<typeof t>;
    expectTypeOf<Input>().toEqualTypeOf<{
      address: { city: string; zip: string };
    }>();
  });
});

// === InferUpdateInput ===

describe("InferUpdateInput", () => {
  it("makes all fields optional", () => {
    const t = db.type("T", {
      name: db.string(),
      age: db.int(),
    });
    type Input = InferUpdateInput<typeof t>;
    // All fields should be optional
    expectTypeOf<Record<string, never>>().toExtend<Input>();
    expectTypeOf<{ name: string }>().toExtend<Input>();
    expectTypeOf<{ age: number }>().toExtend<Input>();
    expectTypeOf<{ name: string; age: number }>().toExtend<Input>();
  });

  it("excludes id and auto-generated fields", () => {
    const t = db.type("T", {
      name: db.string(),
      seq: db.int().serial({ start: 1 }),
      createdAt: db.datetime().hooks({ create: () => new Date() }),
    });
    type Input = InferUpdateInput<typeof t>;
    // Only name should be present (optional)
    expectTypeOf<{ name: string }>().toExtend<Input>();
    // Should not accept seq or createdAt
    type Keys = keyof Input;
    expectTypeOf<Keys>().toEqualTypeOf<"name">();
  });
});

// === InferGqlResult ===

describe("InferGqlResult", () => {
  it("includes id as string", () => {
    const t = db.type("T", { name: db.string() });
    type Result = InferGqlResult<typeof t>;
    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  it("includes all field types", () => {
    const t = db.type("T", {
      name: db.string(),
      count: db.int(),
      active: db.bool(),
      price: db.float(),
      birth: db.date(),
      ts: db.datetime(),
      open: db.time(),
    });
    type Result = InferGqlResult<typeof t>;
    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      name: string;
      count: number;
      active: boolean;
      price: number;
      birth: string;
      ts: string;
      open: string;
    }>();
  });

  it("includes optional fields with null", () => {
    const t = db.type("T", {
      bio: db.string({ optional: true }),
    });
    type Result = InferGqlResult<typeof t>;
    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      bio: string | null;
    }>();
  });

  it("includes hooked/serial fields in output", () => {
    const t = db.type("T", {
      name: db.string(),
      seq: db.int().serial({ start: 1 }),
      createdAt: db.datetime().hooks({ create: () => new Date() }),
    });
    type Result = InferGqlResult<typeof t>;
    // All fields should be present in result
    expectTypeOf<Result>().toHaveProperty("id");
    expectTypeOf<Result>().toHaveProperty("name");
    expectTypeOf<Result>().toHaveProperty("seq");
    expectTypeOf<Result>().toHaveProperty("createdAt");
  });

  it("maps enum fields to literal union", () => {
    const t = db.type("T", {
      status: db.enum(["ACTIVE", "INACTIVE"]),
    });
    type Result = InferGqlResult<typeof t>;
    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      status: "ACTIVE" | "INACTIVE";
    }>();
  });
});

// === GqlVariables / GqlResult fallback ===
// Note: GeneratedGqlSchema is augmented later in this file, so the schema
// is populated. Unregistered literal operations produce the error type.

describe("GqlVariables fallback", () => {
  it("returns error type for unregistered operations when schema is populated", () => {
    type V = GqlVariables<"unknownOperation">;
    expectTypeOf<V>().toEqualTypeOf<{
      readonly __error: 'Unknown GraphQL operation: "unknownOperation". Run type generation to register it in GeneratedGqlSchema.';
    }>();
  });

  it("returns Record<string, unknown> for non-literal string type", () => {
    type V = GqlVariables<string>;
    expectTypeOf<V>().toEqualTypeOf<Record<string, unknown>>();
  });
});

describe("GqlResult fallback", () => {
  it("returns error type for unregistered operations when schema is populated", () => {
    type R = GqlResult<"unknownOperation">;
    expectTypeOf<R>().toEqualTypeOf<{
      readonly __error: 'Unknown GraphQL operation: "unknownOperation". Run type generation to register it in GeneratedGqlSchema.';
    }>();
  });

  it("returns unknown for non-literal string type", () => {
    type R = GqlResult<string>;
    expectTypeOf<R>().toEqualTypeOf<unknown>();
  });
});

// === Module augmentation tests ===

const testProduct = db.type("TestProduct", {
  name: db.string(),
  price: db.float(),
  sku: db.string({ optional: true }),
});

declare module "./infer" {
  interface GeneratedGqlSchema {
    createTestProduct: {
      variables: { input: InferCreateInput<typeof testProduct> };
      result: { createTestProduct: InferGqlResult<typeof testProduct> };
    };
    updateTestProduct: {
      variables: { id: string; input: InferUpdateInput<typeof testProduct> };
      result: { updateTestProduct: InferGqlResult<typeof testProduct> };
    };
    testProducts: {
      variables: Record<string, unknown>;
      result: { testProducts: { collection: InferGqlResult<typeof testProduct>[] } };
    };
  }
}

describe("GqlVariables with augmented GeneratedGqlSchema", () => {
  it("resolves variables type for registered create operation", () => {
    type V = GqlVariables<"createTestProduct">;
    expectTypeOf<V>().toEqualTypeOf<{
      input: { name: string; price: number; sku?: string | null };
    }>();
  });

  it("resolves variables type for registered update operation", () => {
    type V = GqlVariables<"updateTestProduct">;
    expectTypeOf<V>().toEqualTypeOf<{
      id: string;
      input: { name?: string | null; price?: number | null; sku?: string | null };
    }>();
  });

  it("returns error type for unregistered operations", () => {
    type V = GqlVariables<"unregisteredOp">;
    expectTypeOf<V>().toEqualTypeOf<{
      readonly __error: 'Unknown GraphQL operation: "unregisteredOp". Run type generation to register it in GeneratedGqlSchema.';
    }>();
  });
});

describe("GqlResult with augmented GeneratedGqlSchema", () => {
  it("resolves result type for registered create operation", () => {
    type R = GqlResult<"createTestProduct">;
    expectTypeOf<R>().toEqualTypeOf<{
      createTestProduct: { id: string; name: string; price: number; sku: string | null };
    }>();
  });

  it("resolves result type for registered list operation", () => {
    type R = GqlResult<"testProducts">;
    expectTypeOf<R>().toEqualTypeOf<{
      testProducts: {
        collection: { id: string; name: string; price: number; sku: string | null }[];
      };
    }>();
  });

  it("returns error type for unregistered operations", () => {
    type R = GqlResult<"unregisteredOp">;
    expectTypeOf<R>().toEqualTypeOf<{
      readonly __error: 'Unknown GraphQL operation: "unregisteredOp". Run type generation to register it in GeneratedGqlSchema.';
    }>();
  });
});

import { describe, it, expectTypeOf } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import type {
  ExtractRootField,
  InferCreateInput,
  InferUpdateInput,
  InferGqlResult,
  GqlVariables,
  GqlResult,
  StrictKeys,
  ResolvedGqlVariables,
  ValidateGqlQuery,
  _StripGqlModifiers,
  _ParsedVarTypeNames,
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
  interface GeneratedGqlTypeNames {
    TestProductCreateInput: true;
    TestProductUpdateInput: true;
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

// === StrictKeys ===

describe("StrictKeys", () => {
  it("does not recurse into arrays", () => {
    type Shape = { items: string[] };
    type T = { items: string[] };
    type Result = StrictKeys<T, Shape>;
    // Array should pass through without recursion
    expectTypeOf<Result["items"]>().toEqualTypeOf<string[]>();
  });

  it("does not recurse into functions", () => {
    type Shape = { fn: () => void };
    type T = { fn: () => void };
    type Result = StrictKeys<T, Shape>;
    // Function should pass through without recursion
    expectTypeOf<Result["fn"]>().toEqualTypeOf<() => void>();
  });

  it("recurses into nested objects", () => {
    type Shape = { nested: { a: string } };
    type T = { nested: { a: string; b: number } };
    type Result = StrictKeys<T, Shape>;
    // a should be preserved, b should be mapped to never since it's not in Shape
    expectTypeOf<Result["nested"]["a"]>().toEqualTypeOf<string>();
    expectTypeOf<Result["nested"]["b"]>().toEqualTypeOf<never>();
  });

  it("maps excess top-level keys to never", () => {
    type Shape = { a: string };
    type T = { a: string; extra: number };
    type Result = StrictKeys<T, Shape>;
    expectTypeOf<Result["extra"]>().toEqualTypeOf<never>();
  });
});

// === _MergeVarNamesWithSchema (via ResolvedGqlVariables) ===

describe("ResolvedGqlVariables with variable declarations", () => {
  it("picks variables when declaration exactly matches schema keys", () => {
    // createTestProduct has variables: { input: ... }
    // Declaration has $input → exact match → pick
    type V =
      ResolvedGqlVariables<"mutation createTestProduct($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<{
      input: { name: string; price: number; sku?: string | null };
    }>();
  });

  it("falls back to full schema when declaration is a proper subset", () => {
    // updateTestProduct has variables: { id: string; input: ... }
    // Declaration only has $id → proper subset → full schema
    type V =
      ResolvedGqlVariables<"mutation updateTestProduct($id: ID!) { updateTestProduct(id: $id, input: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<{
      id: string;
      input: { name?: string | null; price?: number | null; sku?: string | null };
    }>();
  });

  it("maps unknown variable names to never (type error)", () => {
    // createTestProduct has variables: { input: ... }
    // Declaration has $input2 → not in schema → pick → input2 becomes never
    type V =
      ResolvedGqlVariables<"mutation createTestProduct($input2: TestProductCreateInput!) { createTestProduct(input: $input2) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<{ input2: never }>();
  });
});

// === ValidateGqlQuery ===

describe("ValidateGqlQuery", () => {
  it("returns the query type for a valid registered mutation", () => {
    type Q = "mutation { createTestProduct(input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns the query type for a valid registered query", () => {
    type Q = "query { testProducts { collection { id } } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns the query type for shorthand syntax", () => {
    type Q = "{ testProducts { collection { id } } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns error for query without selection set", () => {
    type V = ValidateGqlQuery<"hello world">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Invalid GraphQL query. Must contain a selection set "{ ... }".'>();
  });

  it("returns error for query with invalid keyword", () => {
    type V = ValidateGqlQuery<"select { foo { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Invalid GraphQL query. Must start with "query", "mutation", "subscription", or "{".'>();
  });

  it("returns error for unregistered operation", () => {
    type V = ValidateGqlQuery<"mutation { unknownOp(input: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Unknown GraphQL operation: "unknownOp". Run type generation to register it in GeneratedGqlSchema.'>();
  });

  it("is permissive for non-literal string type", () => {
    type V = ValidateGqlQuery<string>;
    expectTypeOf<V>().toEqualTypeOf<string>();
  });

  it("returns the query type for query with parenthesized variables", () => {
    type Q = "query($id: ID!) { testProducts { collection { id } } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns the query type for mutation with parenthesized variables", () => {
    type Q =
      "mutation($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns the query type for multiline registered mutation", () => {
    type Q = `
      mutation createTestProduct($input: TestProductCreateInput!) {
        createTestProduct(input: $input) {
          id
        }
      }
    `;
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns error for unmatched opening brace", () => {
    type V = ValidateGqlQuery<"query { testProducts { id }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Invalid GraphQL query. Mismatched curly braces "{" and "}".'>();
  });

  it("returns error for unmatched closing brace", () => {
    type V = ValidateGqlQuery<"query { testProducts { id } } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Invalid GraphQL query. Mismatched curly braces "{" and "}".'>();
  });

  it("returns error for unmatched opening paren", () => {
    type V = ValidateGqlQuery<"query($id: ID! { testProducts { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Invalid GraphQL query. Mismatched parentheses "(" and ")".'>();
  });

  it("returns the query type for balanced braces and parens", () => {
    type Q =
      "mutation($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns the query type for correct field argument name", () => {
    type Q = "mutation { createTestProduct(input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns error for wrong field argument name", () => {
    type V = ValidateGqlQuery<"mutation { createTestProduct(wrongArg: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Unknown field argument "wrongArg" for operation "createTestProduct".'>();
  });

  it("passes for query without field arguments", () => {
    type Q = "query { testProducts { collection { id } } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("passes for permissive variables (Record<string, unknown>)", () => {
    // testProducts has variables: Record<string, unknown>
    type Q = "query { testProducts(anyArg: $val) { collection { id } } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("passes for multiple correct field arguments", () => {
    type Q = "mutation { updateTestProduct(id: $id, input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns error when one of multiple field arguments is wrong", () => {
    type V = ValidateGqlQuery<"mutation { updateTestProduct(id: $id, wrongArg: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Unknown field argument "wrongArg" for operation "updateTestProduct".'>();
  });

  it("parses field arguments correctly in multiline query", () => {
    type Q = `
      mutation {
        createTestProduct(input: $input) {
          id
        }
      }
    `;
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns error for unknown variable type name", () => {
    type V =
      ValidateGqlQuery<"mutation($input: FakeInput!) { createTestProduct(input: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Unknown GraphQL type "FakeInput" in variable declaration. Run type generation to register it in GeneratedGqlTypeNames.'>();
  });

  it("passes for registered variable type name", () => {
    type Q =
      "mutation($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("passes for built-in scalar type in variable declaration", () => {
    type Q = "query($id: ID!) { testProducts { collection { id } } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });

  it("returns error for unknown type among multiple variable declarations", () => {
    type V =
      ValidateGqlQuery<"mutation($id: ID!, $input: NonExistentInput!) { updateTestProduct(id: $id, input: $input) { id } }">;
    expectTypeOf<V>().toEqualTypeOf<'Error: Unknown GraphQL type "NonExistentInput" in variable declaration. Run type generation to register it in GeneratedGqlTypeNames.'>();
  });

  it("passes for mixed built-in and registered types", () => {
    type Q =
      "mutation($id: ID!, $input: TestProductUpdateInput!) { updateTestProduct(id: $id, input: $input) { id } }";
    type V = ValidateGqlQuery<Q>;
    expectTypeOf<V>().toEqualTypeOf<Q>();
  });
});

// === _StripGqlModifiers ===

describe("_StripGqlModifiers", () => {
  it("strips trailing !", () => {
    expectTypeOf<_StripGqlModifiers<"UserCreateInput!">>().toEqualTypeOf<"UserCreateInput">();
  });

  it("strips surrounding brackets", () => {
    expectTypeOf<_StripGqlModifiers<"[UserCreateInput]">>().toEqualTypeOf<"UserCreateInput">();
  });

  it("strips combined [!]!", () => {
    expectTypeOf<_StripGqlModifiers<"[UserCreateInput!]!">>().toEqualTypeOf<"UserCreateInput">();
  });

  it("returns bare type name unchanged", () => {
    expectTypeOf<_StripGqlModifiers<"ID">>().toEqualTypeOf<"ID">();
  });
});

// === _ParsedVarTypeNames ===

describe("_ParsedVarTypeNames", () => {
  it("extracts single type name from variable declaration", () => {
    type R =
      _ParsedVarTypeNames<"mutation($input: UserCreateInput!) { createTestProduct(input: $input) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"UserCreateInput">();
  });

  it("extracts multiple type names as a union", () => {
    type R =
      _ParsedVarTypeNames<"mutation($id: ID!, $input: TestProductCreateInput!) { updateTestProduct(id: $id, input: $input) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<"ID" | "TestProductCreateInput">();
  });

  it("resolves to never when no variable block", () => {
    type R = _ParsedVarTypeNames<"mutation { createTestProduct(input: $input) { id } }">;
    expectTypeOf<R>().toEqualTypeOf<never>();
  });
});

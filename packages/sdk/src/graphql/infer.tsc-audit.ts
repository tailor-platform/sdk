/**
 * Type-level audit: verify ALL expectTypeOf assertions from infer.test.ts via tsc.
 *
 * WHY THIS FILE EXISTS:
 * vitest's `expectTypeOf().toEqualTypeOf()` can silently pass for complex
 * conditional types combined with string literals. This was demonstrated by the
 * `_KeywordBoundary` bug in `ValidateGqlQuery`, where `infer.test.ts` failed to
 * detect the regression.
 *
 * By running `tsc --noEmit` directly against this file, we perform bidirectional
 * type equality checks that bypass vitest's type checker and catch regressions
 * that vitest misses.
 *
 * SYNC MECHANISM:
 * The companion test file `infer.tsc-audit.test.ts` automatically verifies that
 * the number of `Assert<>` checks here is >= the number of `expectTypeOf` calls
 * in `infer.test.ts`, preventing assertion coverage from falling behind.
 *
 * DEDICATED TSCONFIG:
 * This file is compiled via `tsconfig.tsc-audit.json` (not the main tsconfig)
 * to avoid `declare module` conflicts with `infer.test.ts`.
 */

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
} from "@/graphql/infer";

// === Assertion utilities ===

/**
 * Function-based type equality check. Leverages TypeScript's deferred
 * conditional type resolution to compare types at the constraint level.
 *
 * Advantages over bidirectional-extends `[T] extends [U]` approach:
 * - Correctly distinguishes `any` from concrete types
 * - Correctly distinguishes `unknown` from `any`
 * - Correctly distinguishes `readonly` from mutable properties
 *
 * Known trade-off: treats `A & B` as different from `{ a: string; b: number }`
 * even when structurally identical. This is not an issue here because all
 * inferred types are flattened via `Prettify`.
 */
type IsEqual<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? true : false;

/**
 * Compile-time assertion: produces a type error when T is not `true`.
 */
type Assert<_T extends true> = true;

// === IsEqual self-tests ===

// Positive: identical types
type _self_str = Assert<IsEqual<string, string>>;
type _self_num = Assert<IsEqual<number, number>>;
type _self_bool = Assert<IsEqual<boolean, boolean>>;
type _self_never = Assert<IsEqual<never, never>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: testing IsEqual with any
type _self_any = Assert<IsEqual<any, any>>;
type _self_unknown = Assert<IsEqual<unknown, unknown>>;

// Negative: different types must not be equal
// @ts-expect-error -- string !== number
type _self_neg_str_num = Assert<IsEqual<string, number>>;
// @ts-expect-error -- any !== string
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: testing IsEqual with any
type _self_neg_any_str = Assert<IsEqual<any, string>>;
// @ts-expect-error -- unknown !== any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: testing IsEqual with any
type _self_neg_unknown_any = Assert<IsEqual<unknown, any>>;
// @ts-expect-error -- never !== string
type _self_neg_never_str = Assert<IsEqual<never, string>>;

// === ExtractRootField ===

// mutation with variables declaration
type ERF_1 =
  ExtractRootField<"mutation createFoo($input: FooInput!) { createFoo(input: $input) { id } }">;
type _erf1 = Assert<IsEqual<ERF_1, "createFoo">>;

// shorthand mutation
type ERF_2 = ExtractRootField<"mutation { createFoo(input: $input) { id } }">;
type _erf2 = Assert<IsEqual<ERF_2, "createFoo">>;

// query with variables declaration
type ERF_3 = ExtractRootField<"query GetSalesOrder($id: ID!) { salesOrder(id: $id) { id } }">;
type _erf3 = Assert<IsEqual<ERF_3, "salesOrder">>;

// shorthand query
type ERF_4 = ExtractRootField<"{ salesOrder(id: $id) { id } }">;
type _erf4 = Assert<IsEqual<ERF_4, "salesOrder">>;

// query without parentheses
type ERF_5 = ExtractRootField<"query { users { id } }">;
type _erf5 = Assert<IsEqual<ERF_5, "users">>;

// multiline query
type ERF_6 = ExtractRootField<`
  mutation createUser($input: UserInput!) {
    createUser(input: $input) {
      id
    }
  }
`>;
type _erf6 = Assert<IsEqual<ERF_6, "createUser">>;

// delete mutation
type ERF_7 = ExtractRootField<"mutation { deleteUser(id: $id) { id } }">;
type _erf7 = Assert<IsEqual<ERF_7, "deleteUser">>;

// update mutation
type ERF_8 = ExtractRootField<"mutation { updateUser(id: $id, input: $input) { id } }">;
type _erf8 = Assert<IsEqual<ERF_8, "updateUser">>;

// non-literal string fallback
type ERF_9 = ExtractRootField<string>;
type _erf9 = Assert<IsEqual<ERF_9, string>>;

// no braces fallback
type ERF_10 = ExtractRootField<"no braces here">;
type _erf10 = Assert<IsEqual<ERF_10, string>>;

// === InferCreateInput ===

// excludes id field
const ici_t1 = db.type("T1", { name: db.string() });
type ICI_1 = InferCreateInput<typeof ici_t1>;
type _ici1 = Assert<IsEqual<ICI_1, { name: string }>>;

// maps required fields as required
const ici_t2 = db.type("T2", {
  name: db.string(),
  age: db.int(),
});
type ICI_2 = InferCreateInput<typeof ici_t2>;
type _ici2 = Assert<IsEqual<ICI_2, { name: string; age: number }>>;

// maps optional fields — toHaveProperty("name"), toHaveProperty("bio"), name is string
const ici_t3 = db.type("T3", {
  name: db.string(),
  bio: db.string({ optional: true }),
});
type ICI_3 = InferCreateInput<typeof ici_t3>;
type _ici3_has_name = Assert<"name" extends keyof ICI_3 ? true : false>;
type _ici3_has_bio = Assert<"bio" extends keyof ICI_3 ? true : false>;
type ICI_3_Name = ICI_3["name"];
type _ici3_name = Assert<IsEqual<ICI_3_Name, string>>;
// bio should be optional (object extends Pick<ICI_3, "bio">)
type _ici3_bio_optional = Assert<IsEqual<object extends Pick<ICI_3, "bio"> ? true : false, true>>;

// excludes fields with create hooks (field-level)
const ici_t4 = db.type("T4", {
  name: db.string(),
  createdAt: db.datetime().hooks({ create: () => new Date() }),
});
type ICI_4 = InferCreateInput<typeof ici_t4>;
type _ici4 = Assert<IsEqual<ICI_4, { name: string }>>;

// excludes fields with create hooks (type-level)
const ici_t5 = db
  .type("T5", {
    name: db.string(),
    createdAt: db.datetime(),
  })
  .hooks({
    createdAt: { create: () => new Date() },
  });
type ICI_5 = InferCreateInput<typeof ici_t5>;
type _ici5 = Assert<IsEqual<ICI_5, { name: string }>>;

// excludes serial fields
const ici_t6 = db.type("T6", {
  name: db.string(),
  seq: db.int().serial({ start: 1 }),
});
type ICI_6 = InferCreateInput<typeof ici_t6>;
type _ici6 = Assert<IsEqual<ICI_6, { name: string }>>;

// maps enum fields to literal union
const ici_t7 = db.type("T7", {
  status: db.enum(["ACTIVE", "INACTIVE"]),
});
type ICI_7 = InferCreateInput<typeof ici_t7>;
type _ici7 = Assert<IsEqual<ICI_7, { status: "ACTIVE" | "INACTIVE" }>>;

// maps boolean fields
const ici_t8 = db.type("T8", { active: db.bool() });
type ICI_8 = InferCreateInput<typeof ici_t8>;
type _ici8 = Assert<IsEqual<ICI_8, { active: boolean }>>;

// maps date/datetime/time to string
const ici_t9 = db.type("T9", {
  birth: db.date(),
  ts: db.datetime(),
  open: db.time(),
});
type ICI_9 = InferCreateInput<typeof ici_t9>;
type _ici9 = Assert<IsEqual<ICI_9, { birth: string; ts: string; open: string }>>;

// maps uuid fields to string
const ici_t10 = db.type("T10", { ref: db.uuid() });
type ICI_10 = InferCreateInput<typeof ici_t10>;
type _ici10 = Assert<IsEqual<ICI_10, { ref: string }>>;

// maps array fields
const ici_t11 = db.type("T11", {
  tags: db.string({ array: true }),
});
type ICI_11 = InferCreateInput<typeof ici_t11>;
type _ici11 = Assert<IsEqual<ICI_11, { tags: string[] }>>;

// maps nested object fields
const ici_t12 = db.type("T12", {
  address: db.object({
    city: db.string(),
    zip: db.string(),
  }),
});
type ICI_12 = InferCreateInput<typeof ici_t12>;
type _ici12 = Assert<IsEqual<ICI_12, { address: { city: string; zip: string } }>>;

// === InferUpdateInput ===

// makes all fields optional — empty object extends
const iui_t1 = db.type("UT1", {
  name: db.string(),
  age: db.int(),
});
type IUI_1 = InferUpdateInput<typeof iui_t1>;
type _iui1_empty = Assert<Record<string, never> extends IUI_1 ? true : false>;
type _iui1_name = Assert<{ name: string } extends IUI_1 ? true : false>;
type _iui1_age = Assert<{ age: number } extends IUI_1 ? true : false>;
type _iui1_both = Assert<{ name: string; age: number } extends IUI_1 ? true : false>;

// excludes id and auto-generated fields — only name present
const iui_t2 = db.type("UT2", {
  name: db.string(),
  seq: db.int().serial({ start: 1 }),
  createdAt: db.datetime().hooks({ create: () => new Date() }),
});
type IUI_2 = InferUpdateInput<typeof iui_t2>;
type _iui2_extends = Assert<{ name: string } extends IUI_2 ? true : false>;
type IUI_2_Keys = keyof IUI_2;
type _iui2_keys = Assert<IsEqual<IUI_2_Keys, "name">>;

// === InferGqlResult ===

// includes id as string
const igr_t1 = db.type("GR1", { name: db.string() });
type IGR_1 = InferGqlResult<typeof igr_t1>;
type _igr1 = Assert<IsEqual<IGR_1, { id: string; name: string }>>;

// includes all field types
const igr_t2 = db.type("GR2", {
  name: db.string(),
  count: db.int(),
  active: db.bool(),
  price: db.float(),
  birth: db.date(),
  ts: db.datetime(),
  open: db.time(),
});
type IGR_2 = InferGqlResult<typeof igr_t2>;
type _igr2 = Assert<
  IsEqual<
    IGR_2,
    {
      id: string;
      name: string;
      count: number;
      active: boolean;
      price: number;
      birth: string;
      ts: string;
      open: string;
    }
  >
>;

// includes optional fields with null
const igr_t3 = db.type("GR3", {
  bio: db.string({ optional: true }),
});
type IGR_3 = InferGqlResult<typeof igr_t3>;
type _igr3 = Assert<IsEqual<IGR_3, { id: string; bio: string | null }>>;

// includes hooked/serial fields in output — check property existence
const igr_t4 = db.type("GR4", {
  name: db.string(),
  seq: db.int().serial({ start: 1 }),
  createdAt: db.datetime().hooks({ create: () => new Date() }),
});
type IGR_4 = InferGqlResult<typeof igr_t4>;
type _igr4_id = Assert<"id" extends keyof IGR_4 ? true : false>;
type _igr4_name = Assert<"name" extends keyof IGR_4 ? true : false>;
type _igr4_seq = Assert<"seq" extends keyof IGR_4 ? true : false>;
type _igr4_createdAt = Assert<"createdAt" extends keyof IGR_4 ? true : false>;

// maps enum fields to literal union
const igr_t5 = db.type("GR5", {
  status: db.enum(["ACTIVE", "INACTIVE"]),
});
type IGR_5 = InferGqlResult<typeof igr_t5>;
type _igr5 = Assert<IsEqual<IGR_5, { id: string; status: "ACTIVE" | "INACTIVE" }>>;

// === Module augmentation for GqlVariables/GqlResult tests ===

const testProduct = db.type("TestProduct", {
  name: db.string(),
  price: db.float(),
  sku: db.string({ optional: true }),
});

declare module "@/graphql/infer" {
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
      result: {
        testProducts: { collection: InferGqlResult<typeof testProduct>[] };
      };
    };
  }
}

// === GqlVariables fallback ===

// returns error type for unregistered operations when schema is populated
type GV_1 = GqlVariables<"unknownOperation">;
type _gv1 = Assert<
  IsEqual<
    GV_1,
    {
      readonly __error: 'Unknown GraphQL operation: "unknownOperation". Run type generation to register it in GeneratedGqlSchema.';
    }
  >
>;

// returns Record<string, unknown> for non-literal string type
type GV_2 = GqlVariables<string>;
type _gv2 = Assert<IsEqual<GV_2, Record<string, unknown>>>;

// === GqlResult fallback ===

// returns error type for unregistered operations when schema is populated
type GR_1 = GqlResult<"unknownOperation">;
type _gr1 = Assert<
  IsEqual<
    GR_1,
    {
      readonly __error: 'Unknown GraphQL operation: "unknownOperation". Run type generation to register it in GeneratedGqlSchema.';
    }
  >
>;

// returns unknown for non-literal string type
type GR_2 = GqlResult<string>;
type _gr2 = Assert<IsEqual<GR_2, unknown>>;

// Negative: error type for GqlVariables must not be confused with Record<string, unknown>
// @ts-expect-error -- error type !== Record<string, unknown>
type _gv_neg = Assert<IsEqual<GV_1, Record<string, unknown>>>;

// === GqlVariables with augmented GeneratedGqlSchema ===

// resolves variables type for registered create operation
type GVA_1 = GqlVariables<"createTestProduct">;
type _gva1 = Assert<
  IsEqual<GVA_1, { input: { name: string; price: number; sku?: string | null } }>
>;

// resolves variables type for registered update operation
type GVA_2 = GqlVariables<"updateTestProduct">;
type _gva2 = Assert<
  IsEqual<
    GVA_2,
    {
      id: string;
      input: { name?: string | null; price?: number | null; sku?: string | null };
    }
  >
>;

// returns error type for unregistered operations
type GVA_3 = GqlVariables<"unregisteredOp">;
type _gva3 = Assert<
  IsEqual<
    GVA_3,
    {
      readonly __error: 'Unknown GraphQL operation: "unregisteredOp". Run type generation to register it in GeneratedGqlSchema.';
    }
  >
>;

// === GqlResult with augmented GeneratedGqlSchema ===

// resolves result type for registered create operation
type GRA_1 = GqlResult<"createTestProduct">;
type _gra1 = Assert<
  IsEqual<
    GRA_1,
    {
      createTestProduct: {
        id: string;
        name: string;
        price: number;
        sku: string | null;
      };
    }
  >
>;

// resolves result type for registered list operation
type GRA_2 = GqlResult<"testProducts">;
type _gra2 = Assert<
  IsEqual<
    GRA_2,
    {
      testProducts: {
        collection: {
          id: string;
          name: string;
          price: number;
          sku: string | null;
        }[];
      };
    }
  >
>;

// returns error type for unregistered operations
type GRA_3 = GqlResult<"unregisteredOp">;
type _gra3 = Assert<
  IsEqual<
    GRA_3,
    {
      readonly __error: 'Unknown GraphQL operation: "unregisteredOp". Run type generation to register it in GeneratedGqlSchema.';
    }
  >
>;

// === StrictKeys ===

// does not recurse into arrays
type SK_1 = StrictKeys<{ items: string[] }, { items: string[] }>;
type _sk1 = Assert<IsEqual<SK_1["items"], string[]>>;

// does not recurse into functions
type SK_2 = StrictKeys<{ fn: () => void }, { fn: () => void }>;
type _sk2 = Assert<IsEqual<SK_2["fn"], () => void>>;

// recurses into nested objects
type SK_3 = StrictKeys<{ nested: { a: string; b: number } }, { nested: { a: string } }>;
type _sk3a = Assert<IsEqual<SK_3["nested"]["a"], string>>;
type _sk3b = Assert<IsEqual<SK_3["nested"]["b"], never>>;

// maps excess top-level keys to never
type SK_4 = StrictKeys<{ a: string; extra: number }, { a: string }>;
type _sk4 = Assert<IsEqual<SK_4["extra"], never>>;

// === ResolvedGqlVariables with variable declarations ===

// picks variables when declaration exactly matches schema keys
type RGV_1 =
  ResolvedGqlVariables<"mutation createTestProduct($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }">;
type _rgv1 = Assert<
  IsEqual<RGV_1, { input: { name: string; price: number; sku?: string | null } }>
>;

// falls back to full schema when declaration is a proper subset
type RGV_2 =
  ResolvedGqlVariables<"mutation updateTestProduct($id: ID!) { updateTestProduct(id: $id, input: $input) { id } }">;
type _rgv2 = Assert<
  IsEqual<
    RGV_2,
    {
      id: string;
      input: { name?: string | null; price?: number | null; sku?: string | null };
    }
  >
>;

// maps unknown variable names to never (type error)
type RGV_3 =
  ResolvedGqlVariables<"mutation createTestProduct($input2: TestProductCreateInput!) { createTestProduct(input: $input2) { id } }">;
type _rgv3 = Assert<IsEqual<RGV_3, { input2: never }>>;

// === ValidateGqlQuery ===

// returns the query type for a valid registered mutation
type VGQ_1_Q = "mutation { createTestProduct(input: $input) { id } }";
type VGQ_1 = ValidateGqlQuery<VGQ_1_Q>;
type _vgq1 = Assert<IsEqual<VGQ_1, VGQ_1_Q>>;

// returns the query type for a valid registered query
type VGQ_2_Q = "query { testProducts { collection { id } } }";
type VGQ_2 = ValidateGqlQuery<VGQ_2_Q>;
type _vgq2 = Assert<IsEqual<VGQ_2, VGQ_2_Q>>;

// returns the query type for shorthand syntax
type VGQ_3_Q = "{ testProducts { collection { id } } }";
type VGQ_3 = ValidateGqlQuery<VGQ_3_Q>;
type _vgq3 = Assert<IsEqual<VGQ_3, VGQ_3_Q>>;

// returns error for query without selection set
type VGQ_4 = ValidateGqlQuery<"hello world">;
type _vgq4 = Assert<
  IsEqual<VGQ_4, 'Error: Invalid GraphQL query. Must contain a selection set "{ ... }".'>
>;

// returns error for query with invalid keyword
type VGQ_5 = ValidateGqlQuery<"select { foo { id } }">;
type _vgq5 = Assert<
  IsEqual<
    VGQ_5,
    'Error: Invalid GraphQL query. Must start with "query", "mutation", "subscription", or "{".'
  >
>;

// returns error for unregistered operation
type VGQ_6 = ValidateGqlQuery<"mutation { unknownOp(input: $input) { id } }">;
type _vgq6 = Assert<
  IsEqual<
    VGQ_6,
    'Error: Unknown GraphQL operation: "unknownOp". Run type generation to register it in GeneratedGqlSchema.'
  >
>;

// is permissive for non-literal string type
type VGQ_7 = ValidateGqlQuery<string>;
type _vgq7 = Assert<IsEqual<VGQ_7, string>>;

// returns the query type for query with parenthesized variables
type VGQ_8_Q = "query($id: ID!) { testProducts { collection { id } } }";
type VGQ_8 = ValidateGqlQuery<VGQ_8_Q>;
type _vgq8 = Assert<IsEqual<VGQ_8, VGQ_8_Q>>;

// returns the query type for mutation with parenthesized variables
type VGQ_9_Q =
  "mutation($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }";
type VGQ_9 = ValidateGqlQuery<VGQ_9_Q>;
type _vgq9 = Assert<IsEqual<VGQ_9, VGQ_9_Q>>;

// returns the query type for multiline registered mutation
type VGQ_10_Q = `
      mutation createTestProduct($input: TestProductCreateInput!) {
        createTestProduct(input: $input) {
          id
        }
      }
    `;
type VGQ_10 = ValidateGqlQuery<VGQ_10_Q>;
type _vgq10 = Assert<IsEqual<VGQ_10, VGQ_10_Q>>;

// returns error for unmatched opening brace
type VGQ_11 = ValidateGqlQuery<"query { testProducts { id }">;
type _vgq11 = Assert<
  IsEqual<VGQ_11, 'Error: Invalid GraphQL query. Mismatched curly braces "{" and "}".'>
>;

// returns error for unmatched closing brace
type VGQ_12 = ValidateGqlQuery<"query { testProducts { id } } }">;
type _vgq12 = Assert<
  IsEqual<VGQ_12, 'Error: Invalid GraphQL query. Mismatched curly braces "{" and "}".'>
>;

// returns error for unmatched opening paren
type VGQ_13 = ValidateGqlQuery<"query($id: ID! { testProducts { id } }">;
type _vgq13 = Assert<
  IsEqual<VGQ_13, 'Error: Invalid GraphQL query. Mismatched parentheses "(" and ")".'>
>;

// balanced braces and parens pass validation
type VGQ_14_Q =
  "mutation($input: TestProductCreateInput!) { createTestProduct(input: $input) { id } }";
type VGQ_14 = ValidateGqlQuery<VGQ_14_Q>;
type _vgq14 = Assert<IsEqual<VGQ_14, VGQ_14_Q>>;

// Negative: different ValidateGqlQuery error messages must be distinguishable
// @ts-expect-error -- "no selection set" error !== "invalid keyword" error
type _vgq_neg_errors = Assert<IsEqual<VGQ_4, VGQ_5>>;
// @ts-expect-error -- "invalid keyword" error !== "unregistered operation" error
type _vgq_neg_errors2 = Assert<IsEqual<VGQ_5, VGQ_6>>;
// @ts-expect-error -- valid query string !== error string
type _vgq_neg_valid_vs_error = Assert<IsEqual<VGQ_1, VGQ_4>>;
// @ts-expect-error -- brace error !== paren error
type _vgq_neg_brace_vs_paren = Assert<IsEqual<VGQ_11, VGQ_13>>;

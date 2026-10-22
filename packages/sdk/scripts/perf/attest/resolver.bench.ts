import { bench } from "@ark/attest";
import type * as sdk from "../../../src/configure";

declare const createResolver: typeof sdk.createResolver;
declare const t: typeof sdk.t;

bench.baseline(() =>
  createResolver({
    name: "baseline",
    operation: "query",
    input: { id: t.string() },
    body: async (context) => ({ id: context.input.id }),
    output: t.object({ id: t.string() }),
  }),
);

bench("resolver-basic", () => {
  return createResolver({
    name: "resolver0",
    operation: "query",
    input: {
      id: t.string(),
      name: t.string(),
      value: t.int(),
    },
    body: async (context) => ({
      id: context.input.id,
      name: context.input.name,
      processed: true,
    }),
    output: t.object({
      id: t.string(),
      name: t.string(),
      processed: t.bool(),
    }),
  });
}).types([1022, "instantiations"]);

bench("resolver-nested", () => {
  return createResolver({
    name: "resolver0",
    operation: "query",
    input: {
      user: t.object({
        name: t.string(),
        email: t.string(),
        profile: t.object({
          age: t.int(),
          bio: t.string({ optional: true }),
        }),
      }),
    },
    body: async (context) => ({
      user: context.input.user,
      success: true,
    }),
    output: t.object({
      user: t.object({
        name: t.string(),
        email: t.string(),
        profile: t.object({
          age: t.int(),
          bio: t.string({ optional: true }),
        }),
      }),
      success: t.bool(),
    }),
  });
}).types([3405, "instantiations"]);

bench("resolver-array", () => {
  return createResolver({
    name: "resolver0",
    operation: "query",
    input: {
      ids: t.string({ array: true }),
      filters: t.object(
        {
          field: t.string(),
          value: t.string(),
        },
        { array: true },
      ),
    },
    body: async (context) => ({
      items: context.input.ids.map((id) => ({ id, name: "item" })),
      count: context.input.ids.length,
    }),
    output: t.object({
      items: t.object(
        {
          id: t.string(),
          name: t.string(),
        },
        { array: true },
      ),
      count: t.int(),
    }),
  });
}).types([1954, "instantiations"]);

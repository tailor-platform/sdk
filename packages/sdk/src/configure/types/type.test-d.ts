import { createResolver, db, t, type TailorAnyField } from "@tailor-platform/sdk";
import { describe, expectTypeOf, test } from "vitest";

function wrap<F extends TailorAnyField>(field: F) {
  return t.object({ value: field });
}

function paginated<F extends Record<string, TailorAnyField>>(item: F) {
  return t.object({
    items: t.object(item, { array: true }),
    totalCount: t.int(),
  });
}

describe("TailorAnyField", () => {
  test("a helper constrained by it accepts any field and keeps its output type", () => {
    const plain = wrap(t.string());
    expectTypeOf<t.infer<typeof plain>>().toEqualTypeOf<{ value: string }>();
    const described = wrap(t.string().description("Name"));
    expectTypeOf<t.infer<typeof described>>().toEqualTypeOf<{ value: string }>();
    const nested = wrap(t.object({ id: t.uuid() }).typeName("Ref"));
    expectTypeOf<t.infer<typeof nested>>().toEqualTypeOf<{ value: { id: string } }>();
    const status = wrap(t.enum(["A", "B"]));
    expectTypeOf<t.infer<typeof status>>().toEqualTypeOf<{ value: "A" | "B" }>();
    const list = wrap(t.int({ array: true, optional: true }));
    expectTypeOf<t.infer<typeof list>>().toEqualTypeOf<{ value?: number[] | null }>();
    const dbField = wrap(db.string().unique());
    expectTypeOf<t.infer<typeof dbField>>().toEqualTypeOf<{ value: string }>();

    // @ts-expect-error -- a string is not a field
    wrap("x");
    // @ts-expect-error -- a plain object is not a field
    wrap({});
  });

  test("a plain TailorAnyField parameter loses the field's output type", () => {
    const loose = ((field: TailorAnyField) => t.object({ value: field }))(t.string());
    expectTypeOf<t.infer<typeof loose>["value"]>().toBeAny();
  });

  test("helper results build resolver input and output", () => {
    const page = paginated({ id: t.uuid(), name: t.string() });
    expectTypeOf<t.infer<typeof page>>().toEqualTypeOf<{
      items: { id: string; name: string }[];
      totalCount: number;
    }>();

    createResolver({
      name: "listItems",
      operation: "query",
      input: { filter: wrap(t.string()) },
      body: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ filter: { value: string } }>();
        return { items: [], totalCount: 0 };
      },
      output: page,
    });
    createResolver({
      name: "listItemsWrongCount",
      operation: "query",
      // @ts-expect-error -- totalCount must be a number
      body: () => ({ items: [], totalCount: "0" }),
      output: page,
    });
  });
});

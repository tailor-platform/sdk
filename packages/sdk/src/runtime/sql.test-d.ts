import { describe, expectTypeOf, test } from "vitest";
import type { TailordbClientInstance } from "./index";
import type { SqlClient, SqlQuery } from "./sql";

declare const client: TailordbClientInstance;

describe("SqlQuery", () => {
  test("takes params only when the statement has placeholders", () => {
    const withParams = {} as SqlQuery<{ id: string }, { id: string }, "maybeOne">;
    const withoutParams = {} as SqlQuery<Record<never, never>, { id: string }, "many">;

    expectTypeOf(withParams.run(client, { id: "x" })).toEqualTypeOf<
      Promise<{ id: string } | null>
    >();
    expectTypeOf(withoutParams.run(client)).toEqualTypeOf<Promise<{ id: string }[]>>();
    // @ts-expect-error id is required
    void withParams.run(client, {});
    // @ts-expect-error no params to pass
    void withoutParams.run(client, { id: "x" });
  });

  test("resolves to the shape its cardinality allows", () => {
    expectTypeOf<
      ReturnType<SqlQuery<Record<never, never>, { n: number }, "one">["run"]>
    >().toEqualTypeOf<Promise<{ n: number }>>();
    expectTypeOf<ReturnType<SqlQuery<Record<never, never>, never, "none">["run"]>>().toEqualTypeOf<
      Promise<void>
    >();
  });

  test("accepts a tailordb.Client", () => {
    expectTypeOf(client).toExtend<SqlClient>();
  });
});

import { describe, expectTypeOf, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { t } from "#/configure/types/type";
import { createStandardSchema, createTailorDBHook } from "#/utils/test/index";

const table = db.table("Probe", {
  name: db.string(),
  note: db.string({ optional: true }),
  tags: db.string({ array: true }),
  count: db.int(),
  ratio: db.float({ optional: true }),
  ok: db.bool(),
  at: db.datetime(),
  day: db.date({ optional: true }),
  clock: db.time(),
  amount: db.decimal(),
  kind: db.enum(["a", "b"]),
  ref: db.uuid(),
  meta: db.object({ x: db.string(), y: db.int({ optional: true }) }),
  ...db.fields.timestamps(),
});

const schema = createStandardSchema(
  t.object({
    ...table.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
    ...table.omitFields(["id", "createdAt", "updatedAt"]),
  }),
  createTailorDBHook(table),
  table,
);

// The text `generateSeedRowType` writes for the same fields; seed-row-type.test.ts holds the other half.
type SeedRow = {
  id?: string | null;
  name: string;
  note?: string | null;
  tags: string[];
  count: number;
  ratio?: number | null;
  ok: boolean;
  at: string | Date;
  day?: string | null;
  clock: string;
  amount: string;
  kind: "a" | "b";
  ref: string;
  meta: { x: string; y?: number | null };
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

describe("the row type generateSeedRowType writes", () => {
  test("is the row type the seed schema of the same table in TypeScript source has", () => {
    type Input = NonNullable<(typeof schema)["~standard"]["types"]>["input"];

    expectTypeOf<SeedRow>().toEqualTypeOf<Input>();
  });
});

import { bench } from "@ark/attest";
import type * as sdk from "../../../src/configure";

declare const db: typeof sdk.db;
declare const t: typeof sdk.t;
declare const createResolver: typeof sdk.createResolver;

export const primeTypeCaches = () => [
  db.table("Prime", { name: db.string() }),
  createResolver({
    name: "prime",
    operation: "query",
    input: { id: t.string() },
    body: async (context) => ({ id: context.input.id }),
    output: t.object({ id: t.string() }),
  }),
];

bench("tailordb-basic", () => {
  return db.table("Type0", {
    stringField: db.string(),
    intField: db.int(),
    boolField: db.bool(),
    uuidField: db.uuid(),
    dateField: db.date(),
    datetimeField: db.datetime(),
    floatField: db.float(),
    timeField: db.time(),
  });
}).types([2314, "instantiations"]);

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
}).types([1020, "instantiations"]);

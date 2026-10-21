import { bench } from "@ark/attest";
import type * as sdk from "../../../src/configure";

declare const db: typeof sdk.db;

const defineTargetType = () => db.table("TargetType", { name: db.string() });
declare const targetType: ReturnType<typeof defineTargetType>;

bench.baseline(() => db.table("Baseline", { name: db.string() }));

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
}).types([2343, "instantiations"]);

bench("tailordb-optional", () => {
  return db.table("Type0", {
    requiredString: db.string(),
    optionalString: db.string({ optional: true }),
    optionalInt: db.int({ optional: true }),
    optionalBool: db.bool({ optional: true }),
    optionalDate: db.date({ optional: true }),
  });
}).types([1149, "instantiations"]);

bench("tailordb-relation", () => {
  return db.table("Type0", {
    name: db.string(),
    targetId: db.uuid().relation({ type: "n-1", toward: { table: targetType } }),
  });
}).types([3794, "instantiations"]);

bench("tailordb-validate", () => {
  return db.table("Type0", {
    name: db
      .string()
      .validate(({ value }) => (value.length <= 0 ? "Must not be empty" : undefined)),
    email: db
      .string()
      .validate(({ value }) => (!value.includes("@") ? "Must be valid email" : undefined)),
    age: db.int().validate(({ value }) => (value < 0 ? "Must be non-negative" : undefined)),
  });
}).types([186, "instantiations"]);

bench("tailordb-hooks", () => {
  return db.table("Type0", {
    name: db.string().hooks({ create: () => "default" }),
    createdAt: db.datetime().hooks({ create: () => new Date() }),
    updatedAt: db.datetime({ optional: true }).hooks({ update: () => new Date() }),
  });
}).types([981, "instantiations"]);

bench("tailordb-object", () => {
  return db.table("Type0", {
    name: db.string(),
    address: db.object({
      street: db.string(),
      city: db.string(),
      country: db.string(),
      zip: db.string({ optional: true }),
    }),
    metadata: db.object({
      tags: db.string({ optional: true }),
      priority: db.int({ optional: true }),
    }),
  });
}).types([1890, "instantiations"]);

bench("tailordb-enum", () => {
  return db.table("Type0", {
    name: db.string(),
    status: db.enum(["ACTIVE", "INACTIVE", "PENDING", "ARCHIVED"]),
    priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    category: db.enum(["A", "B", "C", "D", "E"]),
  });
}).types([568, "instantiations"]);

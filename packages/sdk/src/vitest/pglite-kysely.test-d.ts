import {
  type ColumnType,
  type Insertable,
  type Kysely,
  type Transaction,
  type Updateable,
} from "kysely";
import { assertType, describe, expectTypeOf, test } from "vitest";
import type { ArrayColumnType, Generated, Timestamp } from "#/kysely/index";
import type { Unmigrated } from "./pglite-kysely";

// Mirrors what the migration generator writes to db.ts: `updatedAt`, `role`,
// and `holidays` are made required by the migration, so their select slot
// stays nullable while their write slots do not; `tier` and `plan` lose the
// "bronze" value, so their select slot still lists it while their write slots
// do not.
interface Database {
  User: {
    id: Generated<string>;
    name: string;
    updatedAt: ColumnType<Date | null, Date | string, Date | string>;
    role: ColumnType<string | null, string, string>;
    holidays: ColumnType<Date[] | null, (Date | string)[], (Date | string)[]>;
    tier: ColumnType<"gold" | "silver" | "bronze", "gold" | "silver", "gold" | "silver">;
    plan: ColumnType<
      "gold" | "silver" | "bronze" | null,
      "gold" | "silver" | null,
      "gold" | "silver" | null
    >;
    roles: ColumnType<("admin" | "user" | "guest")[], ("admin" | "user")[], ("admin" | "user")[]>;
    canceledAt: Timestamp | null;
    stamps: ArrayColumnType<Timestamp> | null;
    createdAt: Timestamp;
  };
}

type Staged = Unmigrated<Database>;

declare function main(trx: Transaction<Database>): Promise<void>;

describe("Unmigrated", () => {
  test("adds null to the write slots of a column whose select slot is nullable", () => {
    expectTypeOf<Staged["User"]["updatedAt"]>().toEqualTypeOf<
      ColumnType<Date | null, Date | string | null, Date | string | null>
    >();
    expectTypeOf<Staged["User"]["role"]>().toEqualTypeOf<
      ColumnType<string | null, string | null, string | null>
    >();
    expectTypeOf<Staged["User"]["holidays"]>().toEqualTypeOf<
      ColumnType<Date[] | null, (Date | string)[] | null, (Date | string)[] | null>
    >();
  });

  test("adds the removed values back to the write slots of a narrowed enum", () => {
    expectTypeOf<Staged["User"]["tier"]>().toEqualTypeOf<
      ColumnType<
        "gold" | "silver" | "bronze",
        "gold" | "silver" | "bronze",
        "gold" | "silver" | "bronze"
      >
    >();
    expectTypeOf<Staged["User"]["plan"]>().toEqualTypeOf<
      ColumnType<
        "gold" | "silver" | "bronze" | null,
        "gold" | "silver" | "bronze" | null,
        "gold" | "silver" | "bronze" | null
      >
    >();
    expectTypeOf<Staged["User"]["roles"]>().toEqualTypeOf<
      ColumnType<
        ("admin" | "user" | "guest")[],
        ("admin" | "user" | "guest")[],
        ("admin" | "user" | "guest")[]
      >
    >();
  });

  test("leaves every other column as generated", () => {
    expectTypeOf<Staged["User"]["id"]>().toEqualTypeOf<Generated<string>>();
    expectTypeOf<Staged["User"]["name"]>().toEqualTypeOf<string>();
    expectTypeOf<Staged["User"]["canceledAt"]>().toEqualTypeOf<Timestamp | null>();
    expectTypeOf<Staged["User"]["stamps"]>().toEqualTypeOf<ArrayColumnType<Timestamp> | null>();
    expectTypeOf<Staged["User"]["createdAt"]>().toEqualTypeOf<Timestamp>();
  });

  test("accepts null for the not-yet-backfilled columns when staging rows", () => {
    assertType<Insertable<Staged["User"]>>({
      name: "a",
      createdAt: new Date(),
      updatedAt: null,
      role: null,
      holidays: null,
      tier: "bronze",
      plan: "bronze",
      roles: ["guest"],
    });
    assertType<Updateable<Staged["User"]>>({
      updatedAt: null,
      role: null,
      holidays: null,
      tier: "bronze",
      plan: "bronze",
    });
    assertType<Insertable<Database["User"]>>({
      name: "a",
      createdAt: new Date(),
      // @ts-expect-error the strict schema keeps the insert slot non-null
      updatedAt: null,
      role: "admin",
      holidays: [],
      tier: "gold",
      roles: ["admin"],
    });
    assertType<Insertable<Database["User"]>>({
      name: "a",
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "admin",
      holidays: [],
      // @ts-expect-error the strict schema keeps the removed value out of the insert slot
      tier: "bronze",
      roles: ["admin"],
    });
  });

  test("keeps the other constraints of the strict schema", () => {
    assertType<Insertable<Staged["User"]>>({
      // @ts-expect-error a required column stays required
      name: undefined,
      createdAt: new Date(),
      updatedAt: null,
      role: null,
      holidays: null,
      tier: "gold",
      roles: [],
    });
    assertType<Insertable<Staged["User"]>>({
      name: "a",
      // @ts-expect-error a non-null column stays non-null
      createdAt: null,
      updatedAt: null,
      role: null,
      holidays: null,
      tier: "gold",
      roles: [],
    });
    assertType<Insertable<Staged["User"]>>({
      name: "a",
      createdAt: new Date(),
      updatedAt: null,
      role: null,
      holidays: null,
      // @ts-expect-error a value the column never held stays rejected
      tier: "platinum",
      roles: [],
    });
  });

  test("hands the migration script a transaction typed against the strict schema", () => {
    const db = {} as Kysely<Staged>;
    expectTypeOf(db.transaction().execute((trx) => main(trx))).toEqualTypeOf<Promise<void>>();
  });
});

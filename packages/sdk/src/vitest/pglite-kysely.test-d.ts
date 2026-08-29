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
// stays nullable while their write slots do not.
interface Database {
  User: {
    id: Generated<string>;
    name: string;
    updatedAt: ColumnType<Date | null, Date | string, Date | string>;
    role: ColumnType<string | null, string, string>;
    holidays: ColumnType<Date[] | null, (Date | string)[], (Date | string)[]>;
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
    });
    assertType<Updateable<Staged["User"]>>({ updatedAt: null, role: null, holidays: null });
    assertType<Insertable<Database["User"]>>({
      name: "a",
      createdAt: new Date(),
      // @ts-expect-error the strict schema keeps the insert slot non-null
      updatedAt: null,
      role: "admin",
      holidays: [],
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
    });
    assertType<Insertable<Staged["User"]>>({
      name: "a",
      // @ts-expect-error a non-null column stays non-null
      createdAt: null,
      updatedAt: null,
      role: null,
      holidays: null,
    });
  });

  test("hands the migration script a transaction typed against the strict schema", () => {
    const db = {} as Kysely<Staged>;
    expectTypeOf(db.transaction().execute((trx) => main(trx))).toEqualTypeOf<Promise<void>>();
  });
});

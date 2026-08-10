import { describe, test, assertType, expectTypeOf } from "vitest";
import { db, type TailorAnyDBField } from "#/configure/services/tailordb/index";
import type {
  Generated,
  ObjectColumnType,
  ArrayColumnType,
  Timestamp,
  NamespaceInsertable,
  NamespaceSelectable,
  Serial,
  Insertable,
  Selectable,
  TailorDBInsertable,
  TailorDBSelectable,
  TailorDBUpdateable,
} from "./index";

// Sanity check: verify typecheck catches errors
describe("typecheck sanity", () => {
  test("string is not assignable to number", () => {
    // @ts-expect-error string is not assignable to number
    assertType<number>("hello");
  });
});

// Matches actual generated types
type TestNamespace = {
  testNs: {
    Receipt: {
      id: Generated<string>;
      // 1. plain timestamp
      receiptDate: Timestamp;
      // 2. timestamp inside object
      dueSchedule: ObjectColumnType<{
        dueDate: Timestamp;
        reminderAt?: Timestamp | null;
      }>;
      // 3. timestamp inside object x array
      metadata: ArrayColumnType<
        ObjectColumnType<{
          created: Timestamp;
          lastUpdated?: Timestamp | null;
          version: number;
        }>
      >;
      // 4. timestamp array
      eventDates: ArrayColumnType<Timestamp>;
    };
  };
};

describe("NamespaceInsertable", () => {
  test("should accept Date and string for nested datetime on insert", () => {
    type ReceiptInsertable = NamespaceInsertable<TestNamespace, "Receipt">;

    assertType<ReceiptInsertable>({
      receiptDate: new Date(),
      dueSchedule: {
        dueDate: new Date(),
      },
      metadata: [{ created: new Date(), version: 1 }],
      eventDates: [new Date()],
    });

    assertType<ReceiptInsertable>({
      receiptDate: "2024-01-01",
      dueSchedule: {
        dueDate: "2024-01-01",
      },
      metadata: [{ created: "2024-01-01", version: 1 }],
      eventDates: ["2024-01-01"],
    });
  });
});

describe("NamespaceSelectable", () => {
  test("should return Date for both top-level and nested datetime", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["receiptDate"]>().toEqualTypeOf<Date>();
    expectTypeOf<ReceiptSelectable["dueSchedule"]["dueDate"]>().toEqualTypeOf<Date>();
    // Nullable nested fields should be required in select
    expectTypeOf<ReceiptSelectable["dueSchedule"]["reminderAt"]>().toEqualTypeOf<Date | null>();
  });

  test("should return array of resolved objects for ObjectArrayColumnType", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["metadata"]>().toEqualTypeOf<
      { created: Date; lastUpdated: Date | null; version: number }[]
    >();
    expectTypeOf<ReceiptSelectable["metadata"][0]["created"]>().toEqualTypeOf<Date>();
  });

  test("should return Date[] for timestamp array", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["eventDates"]>().toEqualTypeOf<Date[]>();
  });
});

// Field collections as a library generic over `Record<string, TailorAnyDBField>` sees them.
const plainField = { name: db.string() };
const optionalField = { note: db.string({ optional: true }) };
const defaultedField = { status: db.string().default("DRAFT") };
const createHookedField = {
  source: db.string().hooks({ create: ({ input }) => input ?? "MANUAL" }),
};
const updateHookedField = {
  revisedBy: db.string().hooks({ update: ({ input }) => input ?? "system" }),
};
const serialFields = {
  docNumber: db.string().serial({ start: 1, format: "PO-%d" }),
  status: db.string(),
};
const table = db.table("Doc", { name: db.string() });

describe("TailorDBInsertable", () => {
  test("keeps a plain non-nullable field required", () => {
    assertType<TailorDBInsertable<typeof plainField>>({ name: "alice" });
    // @ts-expect-error name has no default/hook, so the caller must supply it
    assertType<TailorDBInsertable<typeof plainField>>({});
  });

  test("makes an optional field omittable", () => {
    assertType<TailorDBInsertable<typeof optionalField>>({});
    assertType<TailorDBInsertable<typeof optionalField>>({ note: null });
  });

  test("makes a .default() field omittable", () => {
    assertType<TailorDBInsertable<typeof defaultedField>>({});
    assertType<TailorDBInsertable<typeof defaultedField>>({ status: "OPEN" });
  });

  test("makes a .hooks({ create }) field omittable", () => {
    assertType<TailorDBInsertable<typeof createHookedField>>({});
    assertType<TailorDBInsertable<typeof createHookedField>>({ source: "IMPORT" });
  });

  test("keeps a .hooks({ update })-only field required", () => {
    assertType<TailorDBInsertable<typeof updateHookedField>>({ revisedBy: "alice" });
    // @ts-expect-error an update-only hook does not populate the field on create
    assertType<TailorDBInsertable<typeof updateHookedField>>({});
  });

  test("rejects a value for a .serial() field", () => {
    assertType<TailorDBInsertable<typeof serialFields>>({ status: "DRAFT" });
    // @ts-expect-error the platform auto-numbers docNumber, so it cannot be supplied
    assertType<TailorDBInsertable<typeof serialFields>>({ status: "DRAFT", docNumber: "PO-1" });
  });

  // Kysely drops undefined columns from the statement, so this is the same as omitting it.
  test("accepts undefined for a .serial() field", () => {
    assertType<TailorDBInsertable<typeof serialFields>>({ status: "DRAFT", docNumber: undefined });
  });

  test("accepts an empty field collection", () => {
    assertType<TailorDBInsertable<Record<string, never>>>({});
  });

  test("accepts a table and makes its id omittable", () => {
    assertType<TailorDBInsertable<typeof table>>({ name: "spec" });
    assertType<TailorDBInsertable<typeof table.fields>>({ name: "spec" });
  });

  // A library constrains its field parameter with the publicly exported TailorAnyDBField.
  test("accepts a collection constrained by the exported TailorAnyDBField", () => {
    function insertableOf<const F extends Record<string, TailorAnyDBField>>(
      _fields: F,
    ): (input: TailorDBInsertable<F>) => void {
      return () => {};
    }

    const insert = insertableOf(serialFields);

    assertType<Parameters<typeof insert>[0]>({ status: "DRAFT" });
  });
});

describe("TailorDBSelectable", () => {
  test("reads every field back, including serial and defaulted ones", () => {
    const fields = {
      docNumber: db.string().serial({ start: 1, format: "PO-%d" }),
      status: db.string().default("DRAFT"),
      note: db.string({ optional: true }),
    };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{
      docNumber: string;
      status: string;
      note: string | null;
    }>();
  });

  test("reads a table's id back as required", () => {
    expectTypeOf<TailorDBSelectable<typeof table>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });
});

describe("TailorDBUpdateable", () => {
  test("makes every caller-writable field optional", () => {
    const fields = { status: db.string(), note: db.string({ optional: true }) };

    expectTypeOf<TailorDBUpdateable<typeof fields>>().toEqualTypeOf<{
      status?: string;
      note?: string | null;
    }>();
  });

  test("rejects a value for a .serial() field", () => {
    assertType<TailorDBUpdateable<typeof serialFields>>({ status: "SHIPPED" });
    // @ts-expect-error a serial value is assigned by the platform, not by the caller
    assertType<TailorDBUpdateable<typeof serialFields>>({ docNumber: "PO-1" });
  });
});

// The column mapping has to match what kyselyTypePlugin writes for the same field.
// `example/tests/kysely-parity.ts` pins that against real generator output; these cases
// cover the field kinds the example project does not exercise. Expectations mirror
// `plugin/builtin/kysely-type/type-processor.test.ts`.
// The column each field resolves to has to match what kyselyTypePlugin writes for it.
// `example/tests/kysely-parity.ts` pins that against real generator output; these cases
// cover the field kinds the example project does not exercise, and read the column
// through the select and insert projections since the map itself is internal.
// Expectations mirror `plugin/builtin/kysely-type/type-processor.test.ts`.
describe("column mapping", () => {
  test("maps datetime and date to Timestamp", () => {
    const fields = { when: db.datetime(), day: db.date() };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{
      when: Date;
      day: Date;
    }>();
    expectTypeOf<TailorDBInsertable<typeof fields>>().toEqualTypeOf<{
      when: Date | string;
      day: Date | string;
    }>();
  });

  test("wraps arrays of Timestamp in ArrayColumnType", () => {
    const fields = {
      eventDates: db.datetime({ array: true }),
      optionalDates: db.date({ array: true, optional: true }),
    };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{
      eventDates: Date[];
      optionalDates: Date[] | null;
    }>();
    expectTypeOf<TailorDBInsertable<typeof fields>["eventDates"]>().toEqualTypeOf<
      (Date | string)[]
    >();
  });

  test("leaves arrays of plain scalars as arrays", () => {
    const fields = { scores: db.int({ array: true, optional: true }) };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{ scores: number[] | null }>();
  });

  test("keeps enum unions and decimal strings", () => {
    const fields = { role: db.enum(["admin", "user"]), price: db.decimal() };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{
      role: "admin" | "user";
      price: string;
    }>();
  });

  // ObjectColumnType makes an optional nested prop required on read and optional on
  // write; an unwrapped object would keep it optional on both.
  test("wraps an object with optional props in ObjectColumnType", () => {
    const fields = {
      profile: db.object({ name: db.string(), bio: db.string({ optional: true }) }),
    };

    expectTypeOf<TailorDBSelectable<typeof fields>["profile"]>().toEqualTypeOf<{
      name: string;
      bio: string | null;
    }>();
    expectTypeOf<TailorDBInsertable<typeof fields>["profile"]>().toEqualTypeOf<{
      name: string;
      bio?: string | null;
    }>();
  });

  // The runtime hands back a Date for a nested date/datetime too, so the column type has
  // to be Timestamp there as well — see the deserializer the function runtime applies to
  // nested JSON values.
  test("resolves a datetime nested inside an object to Timestamp", () => {
    const fields = {
      schedule: db.object({ dueDate: db.datetime(), day: db.date() }),
      events: db.object(
        { at: db.datetime(), label: db.string({ optional: true }) },
        {
          array: true,
        },
      ),
    };

    expectTypeOf<TailorDBSelectable<typeof fields>["schedule"]>().toEqualTypeOf<{
      dueDate: Date;
      day: Date;
    }>();
    expectTypeOf<TailorDBSelectable<typeof fields>["events"]>().toEqualTypeOf<
      { at: Date; label: string | null }[]
    >();
  });

  test("leaves an all-required object plain, and its array a plain array", () => {
    const fields = {
      item: db.object({ name: db.string(), qty: db.int() }),
      items: db.object({ name: db.string(), qty: db.int() }, { array: true }),
    };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{
      item: { name: string; qty: number };
      items: { name: string; qty: number }[];
    }>();
  });

  test("reads a defaulted datetime back as Date", () => {
    const fields = { createdAt: db.datetime().default("now") };

    expectTypeOf<TailorDBSelectable<typeof fields>>().toEqualTypeOf<{ createdAt: Date }>();
  });
});

// `Serial` is what the generated table types use, so the same rules must hold there.
describe("Serial", () => {
  type GeneratedTable = { id: Generated<string>; docNumber: Serial<string>; total: number };

  test("keeps a serial column out of the insert input", () => {
    assertType<Insertable<GeneratedTable>>({ total: 1 });
    // @ts-expect-error the platform auto-numbers docNumber, so it cannot be supplied
    assertType<Insertable<GeneratedTable>>({ total: 1, docNumber: "PO-1" });
  });

  test("reads a serial column back as its own type", () => {
    expectTypeOf<Selectable<GeneratedTable>["docNumber"]>().toEqualTypeOf<string>();
  });
});

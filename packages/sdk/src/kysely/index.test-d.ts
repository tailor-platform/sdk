import { describe, test, assertType, expectTypeOf } from "vitest";
import type {
  Generated,
  ObjectColumnType,
  ArrayColumnType,
  Timestamp,
  NamespaceInsertable,
  NamespaceSelectable,
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

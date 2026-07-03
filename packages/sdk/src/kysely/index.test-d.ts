import { describe, test, assertType, expectTypeOf } from "vitest";
import type {
  Generated,
  ObjectColumnType,
  ArrayColumnType,
  Timestamp,
  DateString,
  DateTimeString,
  NamespaceInsertable,
  NamespaceSelectable,
  UUIDString,
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
      id: Generated<UUIDString>;
      // 1. plain date
      receiptDate: DateString;
      // 2. plain timestamp
      createdAt: Timestamp;
      // 3. timestamp inside object
      dueSchedule: ObjectColumnType<{
        dueDate: Timestamp;
        reminderAt?: Timestamp | null;
      }>;
      // 4. timestamp inside object x array
      metadata: ArrayColumnType<
        ObjectColumnType<{
          created: Timestamp;
          lastUpdated?: Timestamp | null;
          version: number;
        }>
      >;
      // 5. timestamp array
      eventDates: ArrayColumnType<Timestamp>;
    };
  };
};

describe("NamespaceInsertable", () => {
  test("should accept strict date strings and datetimes on insert", () => {
    type ReceiptInsertable = NamespaceInsertable<TestNamespace, "Receipt">;

    assertType<ReceiptInsertable>({
      receiptDate: "2024-01-01",
      createdAt: new Date(),
      dueSchedule: {
        dueDate: new Date(),
      },
      metadata: [{ created: new Date(), version: 1 }],
      eventDates: [new Date()],
    });

    assertType<ReceiptInsertable>({
      receiptDate: "2024-01-01",
      createdAt: "2024-01-01T00:00:00Z",
      dueSchedule: {
        dueDate: "2024-01-01T00:00:00Z",
      },
      metadata: [{ created: "2024-01-01T00:00:00Z", version: 1 }],
      eventDates: ["2024-01-01T00:00:00Z"],
    });
  });
});

describe("NamespaceSelectable", () => {
  test("should return strict date strings and datetimes", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["receiptDate"]>().toEqualTypeOf<DateString>();
    expectTypeOf<ReceiptSelectable["createdAt"]>().toEqualTypeOf<Date | DateTimeString>();
    expectTypeOf<ReceiptSelectable["dueSchedule"]["dueDate"]>().toEqualTypeOf<
      Date | DateTimeString
    >();
    // Nullable nested fields should be required in select
    expectTypeOf<ReceiptSelectable["dueSchedule"]["reminderAt"]>().toEqualTypeOf<
      Date | DateTimeString | null
    >();
  });

  test("should return array of resolved objects for ObjectArrayColumnType", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["metadata"]>().toEqualTypeOf<
      {
        created: Date | DateTimeString;
        lastUpdated: Date | DateTimeString | null;
        version: number;
      }[]
    >();
    expectTypeOf<ReceiptSelectable["metadata"][0]["created"]>().toEqualTypeOf<
      Date | DateTimeString
    >();
  });

  test("should return datetime arrays for timestamp array", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["eventDates"]>().toEqualTypeOf<(Date | DateTimeString)[]>();
  });
});

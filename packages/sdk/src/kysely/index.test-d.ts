import { describe, it, assertType, expectTypeOf } from "vitest";
import type {
  ColumnType,
  Generated,
  Timestamp,
  NamespaceInsertable,
  NamespaceSelectable,
} from "./index";

// Sanity check: verify typecheck catches errors
describe("typecheck sanity", () => {
  it("string is not assignable to number", () => {
    // @ts-expect-error string is not assignable to number
    assertType<number>("hello");
  });
});

// Matches actual generated types: nested object with datetime is wrapped in ColumnType
type TestNamespace = {
  testNs: {
    Receipt: {
      id: Generated<string>;
      receiptDate: Timestamp;
      dueSchedule: ColumnType<
        { dueDate: string; reminderAt?: string | null },
        { dueDate: Date | string; reminderAt?: Date | string | null },
        { dueDate: Date | string; reminderAt?: Date | string | null }
      >;
    };
  };
};

describe("NamespaceInsertable", () => {
  it("should accept Date and string for nested datetime on insert", () => {
    type ReceiptInsertable = NamespaceInsertable<TestNamespace, "Receipt">;

    assertType<ReceiptInsertable>({
      receiptDate: new Date(),
      dueSchedule: {
        dueDate: new Date(),
      },
    });

    assertType<ReceiptInsertable>({
      receiptDate: "2024-01-01",
      dueSchedule: {
        dueDate: "2024-01-01",
      },
    });
  });
});

describe("NamespaceSelectable", () => {
  it("should return Date for top-level Timestamp and string for nested datetime", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["receiptDate"]>().toEqualTypeOf<Date>();
    expectTypeOf<ReceiptSelectable["dueSchedule"]["dueDate"]>().toEqualTypeOf<string>();
  });
});

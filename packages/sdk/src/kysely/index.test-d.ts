import { describe, it, assertType, expectTypeOf } from "vitest";
import type {
  Generated,
  ObjectColumnType,
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

// Matches actual generated types
type TestNamespace = {
  testNs: {
    Receipt: {
      id: Generated<string>;
      receiptDate: Timestamp;
      dueSchedule: ObjectColumnType<{
        dueDate: Timestamp;
        reminderAt?: Timestamp | null;
      }>;
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
  it("should return Date for both top-level and nested datetime", () => {
    type ReceiptSelectable = NamespaceSelectable<TestNamespace, "Receipt">;

    expectTypeOf<ReceiptSelectable["receiptDate"]>().toEqualTypeOf<Date>();
    expectTypeOf<ReceiptSelectable["dueSchedule"]["dueDate"]>().toEqualTypeOf<Date>();
    // Nullable nested fields should be required in select
    expectTypeOf<ReceiptSelectable["dueSchedule"]["reminderAt"]>().toEqualTypeOf<Date | null>();
  });
});

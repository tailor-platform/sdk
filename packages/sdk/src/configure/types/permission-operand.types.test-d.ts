import { assertType, describe, test } from "vitest";
import type { BooleanFieldKeys, StringFieldKeys } from "./permission-operand.types";

interface TestUser {
  role?: string;
  requiredRole: string;
  isAdmin?: boolean;
  requiredFlag: boolean;
  count: number;
}

describe("StringFieldKeys / BooleanFieldKeys", () => {
  test("include optional string/boolean attribute keys, not just required ones", () => {
    assertType<StringFieldKeys<TestUser>>("role");
    assertType<StringFieldKeys<TestUser>>("requiredRole");
    assertType<BooleanFieldKeys<TestUser>>("isAdmin");
    assertType<BooleanFieldKeys<TestUser>>("requiredFlag");
  });

  test("exclude keys of an unrelated type", () => {
    // @ts-expect-error "count" is a number field, not a string field
    assertType<StringFieldKeys<TestUser>>("count");
    // @ts-expect-error "count" is a number field, not a boolean field
    assertType<BooleanFieldKeys<TestUser>>("count");
  });
});

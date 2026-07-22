import { describe, expect, test } from "vitest";
import { GQL_PERMISSION_INVALID_OPERAND_MESSAGE, TailorDBTypeSchema } from "./schema";

const makeType = (gql: unknown) => ({
  name: "Test",
  fields: {
    id: { type: "uuid", metadata: {} },
  },
  metadata: {
    name: "Test",
    permissions: { gql },
    files: {},
  },
});

function getInvalidOperandIssue(gql: unknown) {
  const result = TailorDBTypeSchema.safeParse(makeType(gql));
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected TailorDBTypeSchema parsing to fail");
  }
  return result.error.issues.find((i) =>
    i.message.includes(GQL_PERMISSION_INVALID_OPERAND_MESSAGE),
  );
}

describe("TailorDBTypeSchema gqlPermission validation", () => {
  test.each([
    ["record", "ownerId", "=", "123", "read"],
    ["oldRecord", "status", "=", "active", "update"],
    ["newRecord", "status", "=", "active", "create"],
  ] as const)("should reject %s operand in gqlPermission", (operand, field, op, value, action) => {
    const issue = getInvalidOperandIssue([
      {
        conditions: [[{ [operand]: field }, op, value]],
        actions: [action],
        permit: true,
      },
    ]);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(`"${operand}" operand is not supported in gqlPermission`);
  });

  test("should allow user operand in gqlPermission", () => {
    const input = makeType([
      {
        conditions: [[{ user: "role" }, "=", "admin"]],
        actions: ["read"],
        permit: true,
      },
    ]);
    const result = TailorDBTypeSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

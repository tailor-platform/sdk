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
  test("should reject record operand in gqlPermission", () => {
    const issue = getInvalidOperandIssue([
      {
        conditions: [[{ record: "ownerId" }, "=", "123"]],
        actions: ["read"],
        permit: true,
      },
    ]);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"record" operand is not supported in gqlPermission');
  });

  test("should reject oldRecord operand in gqlPermission", () => {
    const issue = getInvalidOperandIssue([
      {
        conditions: [[{ oldRecord: "status" }, "=", "active"]],
        actions: ["update"],
        permit: true,
      },
    ]);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"oldRecord" operand is not supported in gqlPermission');
  });

  test("should reject newRecord operand in gqlPermission", () => {
    const issue = getInvalidOperandIssue([
      {
        conditions: [[{ newRecord: "status" }, "=", "active"]],
        actions: ["create"],
        permit: true,
      },
    ]);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"newRecord" operand is not supported in gqlPermission');
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

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

describe("TailorDBTypeSchema name validation", () => {
  test.each(["A", "Item1", "A".repeat(63)])("accepts table name %s", (name) => {
    const input = makeType([]);
    input.name = name;
    input.metadata.name = name;

    expect(TailorDBTypeSchema.safeParse(input).success).toBe(true);
  });

  test.each([
    "",
    "item",
    "1Item",
    "Item_name",
    "Item-name",
    "Item name",
    "Item\n",
    "Café",
    "A".repeat(64),
  ])("rejects invalid table name %j in either name field", (name) => {
    const input = makeType([]);
    input.name = name;
    const result = TailorDBTypeSchema.safeParse(input);
    expect(result.error?.issues).toMatchObject([{ path: ["name"] }]);

    input.name = "Test";
    input.metadata.name = name;
    const metadataResult = TailorDBTypeSchema.safeParse(input);
    expect(metadataResult.error?.issues).toMatchObject([{ path: ["metadata", "name"] }]);
  });
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

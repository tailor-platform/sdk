import { describe, expect, it } from "vitest";
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

describe("TailorDBTypeSchema gqlPermission validation", () => {
  it("should reject record operand in gqlPermission", () => {
    const input = makeType([
      {
        conditions: [[{ record: "ownerId" }, "=", "123"]],
        actions: ["read"],
        permit: true,
      },
    ]);
    const result = TailorDBTypeSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes(GQL_PERMISSION_INVALID_OPERAND_MESSAGE),
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('"record" operand is not supported in gqlPermission');
    }
  });

  it("should reject oldRecord operand in gqlPermission", () => {
    const input = makeType([
      {
        conditions: [[{ oldRecord: "status" }, "=", "active"]],
        actions: ["update"],
        permit: true,
      },
    ]);
    const result = TailorDBTypeSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes(GQL_PERMISSION_INVALID_OPERAND_MESSAGE),
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('"oldRecord" operand is not supported in gqlPermission');
    }
  });

  it("should reject newRecord operand in gqlPermission", () => {
    const input = makeType([
      {
        conditions: [[{ newRecord: "status" }, "=", "active"]],
        actions: ["create"],
        permit: true,
      },
    ]);
    const result = TailorDBTypeSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes(GQL_PERMISSION_INVALID_OPERAND_MESSAGE),
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('"newRecord" operand is not supported in gqlPermission');
    }
  });

  it("should allow user operand in gqlPermission", () => {
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

import { describe, expect, test } from "vitest";
import { validateWorkspaceName, workspaceNameSchema } from "./workspace-name";

describe("workspaceNameSchema", () => {
  test.each(["abc", "a".repeat(63), "my-workspace", "ws-1", "0-9"])("accepts %s", (name) => {
    expect(workspaceNameSchema.safeParse(name).success).toBe(true);
  });

  test.each([
    ["ab", "Name must be at least 3 characters"],
    ["a".repeat(64), "Name must be at most 63 characters"],
    ["MyWorkspace", "Name can only contain lowercase letters, numbers, and hyphens"],
    ["my_workspace", "Name can only contain lowercase letters, numbers, and hyphens"],
    ["my workspace", "Name can only contain lowercase letters, numbers, and hyphens"],
    ["-workspace", "Name cannot start or end with a hyphen"],
    ["workspace-", "Name cannot start or end with a hyphen"],
  ])("rejects %s with a message naming the broken rule", (name, message) => {
    expect(validateWorkspaceName(name)).toContain(message);
  });

  test("reports every broken rule at once", () => {
    // Length, character set, and hyphen placement are independent checks, so a
    // name that breaks several of them must not stop at the first failure.
    expect(validateWorkspaceName("-A")).toBe(
      "Name must be at least 3 characters; Name can only contain lowercase letters, numbers, and hyphens; Name cannot start or end with a hyphen",
    );
  });

  test("accepts a valid name", () => {
    expect(validateWorkspaceName("my-workspace")).toBe(true);
  });
});

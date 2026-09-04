import { describe, expect, test } from "vitest";
import { validateWorkspaceName, workspaceNameRules } from "./workspace-name";

describe("workspaceNameRules", () => {
  test("states every rule the schema enforces", () => {
    expect(workspaceNameRules).toContain("3-63");
    expect(workspaceNameRules).toContain("lowercase letters, numbers, and hyphens");
    expect(workspaceNameRules).toContain("cannot start or end with a hyphen");
  });

  test.each([
    ["my-workspace", true],
    ["abc", true],
    ["a".repeat(63), true],
    ["ab", false],
    ["a".repeat(64), false],
    ["My-Workspace", false],
    ["my_workspace", false],
    ["-my-workspace", false],
    ["my-workspace-", false],
  ])("the documented rules match validation for %s", (name, valid) => {
    expect(validateWorkspaceName(name) === true).toBe(valid);
  });
});

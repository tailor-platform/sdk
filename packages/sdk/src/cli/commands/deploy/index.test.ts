import { describe, expect, test } from "vitest";
import { deployCommand } from "#/cli/commands/deploy/index";

describe("deployCommand", () => {
  test("exposes 'apply' as an alias", () => {
    expect(deployCommand.aliases).toContain("apply");
  });
});

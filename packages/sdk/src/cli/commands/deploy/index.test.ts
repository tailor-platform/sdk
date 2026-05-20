import { describe, expect, it } from "vitest";
import { deployCommand } from "@/cli/commands/deploy";

describe("deployCommand", () => {
  it("exposes 'apply' as an alias", () => {
    expect(deployCommand.aliases).toContain("apply");
  });
});

import { defineCommand, runCommand } from "@tailor-platform/sdk/cli";
import { describe, expect, test, vi } from "vitest";
import { setupSubCommands } from "./commands";
import { setupTarget } from "./generate";

vi.mock("./generate", () => ({
  setupTarget: vi.fn(),
  setupCoordinate: vi.fn(),
}));

vi.mock("./check", () => ({ checkGitHub: vi.fn() }));
vi.mock("./delete", () => ({ setupDelete: vi.fn() }));
vi.mock("./renovate", () => ({ setupRenovate: vi.fn() }));

const setupCommand = defineCommand({
  name: "tailor-setup",
  description: "Set up repository automation for your project. (beta)",
  subCommands: setupSubCommands,
});

describe("setup ci subcommand nesting", () => {
  test("ci branch dispatches to setupTarget with kind branch", async () => {
    const result = await runCommand(setupCommand, ["ci", "branch", "--target", "release"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "branch", branch: "release" }),
    );
  });

  test("ci tag dispatches to setupTarget with kind tag", async () => {
    const result = await runCommand(setupCommand, ["ci", "tag", "--branch", "main"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tag", branch: "main" }),
    );
  });
});

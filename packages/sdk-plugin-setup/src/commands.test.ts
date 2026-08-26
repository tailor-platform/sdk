import { defineCommand, logger, runCommand } from "@tailor-platform/sdk/cli";
import { aroundEach, describe, expect, test, vi } from "vitest";
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

describe("setup branch trigger branch flag", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    const originalArgv = process.argv;
    try {
      await runTest();
    } finally {
      process.argv = originalArgv;
    }
  });

  test("--target sets the deploy trigger branch without a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await runCommand(setupCommand, ["branch", "--target", "release"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "branch", branch: "release" }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test("deprecated --branch alias still works and warns", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    process.argv = ["node", "tailor", "setup", "branch", "--branch", "release"];

    const result = await runCommand(setupCommand, ["branch", "--branch", "release"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "branch", branch: "release" }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("--target"));
  });

  test("--branch= form also warns", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    process.argv = ["node", "tailor", "setup", "branch", "--branch=release"];

    const result = await runCommand(setupCommand, ["branch", "--branch=release"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "branch", branch: "release" }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("--target"));
  });

  test("other subcommands keep --branch without a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    process.argv = ["node", "tailor", "setup", "tag", "--branch", "main"];

    const result = await runCommand(setupCommand, ["tag", "--branch", "main"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tag", branch: "main" }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

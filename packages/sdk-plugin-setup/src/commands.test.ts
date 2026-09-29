import { defineCommand, logger, runCommand } from "@tailor-platform/sdk/cli";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkGitHub } from "./check";
import { setupSubCommands } from "./commands";
import { setupCoordinate, setupTarget } from "./generate";
import { setupUpdate } from "./update";

vi.mock("./generate", () => ({
  setupTarget: vi.fn(),
  setupCoordinate: vi.fn(),
}));

vi.mock("./check", () => ({ checkGitHub: vi.fn() }));
vi.mock("./delete", () => ({ setupDelete: vi.fn() }));
vi.mock("./renovate", () => ({ setupRenovate: vi.fn() }));
vi.mock("./update", () => ({ setupUpdate: vi.fn() }));

const setupCommand = defineCommand({
  name: "tailor-setup",
  description: "Set up repository automation for your project. (beta)",
  subCommands: setupSubCommands,
});

describe("setup ci subcommand nesting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("ci branch dispatches to setupTarget with kind branch", async () => {
    const result = await runCommand(setupCommand, ["ci", "branch", "--target", "release"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "branch", branch: "release" }),
    );
  });

  test("ci branch rejects the removed --branch alias", async () => {
    const result = await runCommand(setupCommand, ["ci", "branch", "--branch", "release"]);

    expect(result.success).toBe(false);
    expect(result.success ? "" : String(result.error)).toContain("Unknown flags: branch");
    expect(setupTarget).not.toHaveBeenCalled();
  });

  test("ci tag dispatches to setupTarget with kind tag", async () => {
    const result = await runCommand(setupCommand, ["ci", "tag", "--branch", "main"]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tag", branch: "main" }),
    );
  });

  test.each([
    ["preview", ["--region", "us-west"], { kind: "preview", region: "us-west" }],
    ["action", [], { kind: "action" }],
  ] as const)("ci %s dispatches to setupTarget", async (subcommand, args, expected) => {
    const result = await runCommand(setupCommand, ["ci", subcommand, ...args]);

    expect(result.success).toBe(true);
    expect(setupTarget).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  test("ci coordinate dispatches to setupCoordinate", async () => {
    const result = await runCommand(setupCommand, [
      "ci",
      "coordinate",
      "--name",
      "apps",
      "--action",
      "api",
    ]);

    expect(result.success).toBe(true);
    expect(setupCoordinate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorName: "apps", actions: ["api"] }),
    );
  });

  test.each(["branch", "tag", "preview", "action", "coordinate"])(
    "rejects the former direct %s subcommand",
    async (subcommand) => {
      const result = await runCommand(setupCommand, [subcommand]);

      expect(result.success).toBe(false);
      expect(result.success ? "" : String(result.error)).toContain(
        `Unknown subcommand: ${subcommand}`,
      );
    },
  );
});

describe("setup check command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("dispatches without an explicit CI flag", async () => {
    const result = await runCommand(setupCommand, ["check"]);

    expect(result.success).toBe(true);
    expect(checkGitHub).toHaveBeenCalledWith({ outputDir: process.cwd() });
  });

  test("rejects the removed --ci flag", async () => {
    const result = await runCommand(setupCommand, ["check", "--ci"]);

    expect(result.success).toBe(false);
    expect(result.success ? "" : String(result.error)).toContain("Unknown flags: ci");
    expect(checkGitHub).not.toHaveBeenCalled();
  });
});

describe("setup update command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("regenerates every target from the lock without --force by default", async () => {
    const result = await runCommand(setupCommand, ["update"]);

    expect(result.success).toBe(true);
    expect(setupUpdate).toHaveBeenCalledWith({ force: false, outputDir: process.cwd() });
  });

  test("passes --force through to every target", async () => {
    const result = await runCommand(setupCommand, ["update", "--force"]);

    expect(result.success).toBe(true);
    expect(setupUpdate).toHaveBeenCalledWith({ force: true, outputDir: process.cwd() });
  });
});

describe("beta warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each([
    [["ci", "branch"]],
    [["ci", "tag"]],
    [["ci", "preview", "--region", "us-west"]],
    [["ci", "action"]],
    [["ci", "coordinate", "--name", "apps", "--action", "api"]],
    [["deps"]],
    [["check"]],
    [["update"]],
    [["delete", "--yes", ".github/workflows/tailor-app.yml"]],
  ])("setup %j warns once that setup is a beta feature", async (argv) => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await runCommand(setupCommand, argv);

    expect(result.success).toBe(true);
    expect(
      warnSpy.mock.calls.filter(([message]) => /beta feature/.test(String(message))),
    ).toHaveLength(1);
  });
});

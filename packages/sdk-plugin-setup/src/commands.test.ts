import { defineCommand, logger, runCommand } from "@tailor-platform/sdk/cli";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkGitHub } from "./check";
import { setupSubCommands } from "./commands";
import { setupEnv } from "./env";
import {
  printCoordinateNextSteps,
  printTargetNextSteps,
  setupCoordinate,
  setupTarget,
} from "./generate";
import { setupUpdate } from "./update";

vi.mock("./generate", () => ({
  setupTarget: vi.fn(),
  setupCoordinate: vi.fn(),
  printTargetNextSteps: vi.fn(),
  printCoordinateNextSteps: vi.fn(),
}));

vi.mock("./check", () => ({ checkGitHub: vi.fn() }));
vi.mock("./env", () => ({ setupEnv: vi.fn() }));
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

  test("ci env prints gh commands by default", async () => {
    const result = await runCommand(setupCommand, ["ci", "env"]);

    expect(result.success).toBe(true);
    expect(setupEnv).toHaveBeenCalledWith({
      outputDir: process.cwd(),
      format: "gh",
      environments: [],
    });
  });

  test("ci env accepts --format terraform", async () => {
    const result = await runCommand(setupCommand, ["ci", "env", "--format", "terraform"]);

    expect(result.success).toBe(true);
    expect(setupEnv).toHaveBeenCalledWith({
      outputDir: process.cwd(),
      format: "terraform",
      environments: [],
    });
  });

  test("ci env narrows the output with repeated --environment flags", async () => {
    const result = await runCommand(setupCommand, [
      "ci",
      "env",
      "--environment",
      "stg",
      "--environment",
      "production",
    ]);

    expect(result.success).toBe(true);
    expect(setupEnv).toHaveBeenCalledWith(
      expect.objectContaining({ environments: ["stg", "production"] }),
    );
  });

  test("ci env rejects an unknown format", async () => {
    const result = await runCommand(setupCommand, ["ci", "env", "--format", "yaml"]);

    expect(result.success).toBe(false);
    expect(setupEnv).not.toHaveBeenCalled();
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

describe("next steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each([
    [["ci", "branch"]],
    [["ci", "tag"]],
    [["ci", "preview", "--region", "us-west"]],
    [["ci", "action"]],
  ])("setup %j prints next steps for the generated target", async (argv) => {
    const result = {
      kind: "branch",
      file: ".github/workflows/tailor-app.yml",
      environment: "app",
      configEdited: false,
    } as const;
    vi.mocked(setupTarget).mockResolvedValue(result);

    await runCommand(setupCommand, argv);

    expect(printTargetNextSteps).toHaveBeenCalledWith(result);
  });

  test("ci coordinate prints next steps for the generated coordinator", async () => {
    const result = {
      file: ".github/workflows/tailor-coordinate-apps.yml",
      environment: "apps",
      tailorSetupFile: ".github/actions/tailor-setup/action.yml",
    };
    vi.mocked(setupCoordinate).mockResolvedValue(result);

    await runCommand(setupCommand, ["ci", "coordinate", "--name", "apps", "--action", "api"]);

    expect(printCoordinateNextSteps).toHaveBeenCalledWith(result);
  });
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
    [["ci", "env"]],
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

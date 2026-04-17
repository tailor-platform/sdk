import { describe, expect, it, vi } from "vitest";
import { SKILL_NAME, buildSkillsAddArgs, runSkillsInstaller } from "./skills-installer";

const TEST_SOURCE = "/fake/sdk/skills";

interface MockChildProcess {
  on(event: "close", listener: (code: number | null) => void): MockChildProcess;
  on(event: "error", listener: (error: Error) => void): MockChildProcess;
}

const createMockChildProcess = () => {
  const listeners = {
    close: [] as Array<(code: number | null) => void>,
    error: [] as Array<(error: Error) => void>,
  };

  function on(event: "close", listener: (code: number | null) => void): MockChildProcess;
  function on(event: "error", listener: (error: Error) => void): MockChildProcess;
  function on(
    event: "close" | "error",
    listener: ((code: number | null) => void) | ((error: Error) => void),
  ): MockChildProcess {
    if (event === "close") {
      listeners.close.push(listener as (code: number | null) => void);
    } else {
      listeners.error.push(listener as (error: Error) => void);
    }
    return process;
  }

  const process: MockChildProcess = { on };

  return {
    process,
    emitClose: (code: number | null) => listeners.close.forEach((listener) => listener(code)),
    emitError: (error: Error) => listeners.error.forEach((listener) => listener(error)),
  };
};

describe("skills-installer", () => {
  it("builds skills add arguments with the provided source and --copy", () => {
    expect(buildSkillsAddArgs({ source: TEST_SOURCE })).toEqual([
      "skills",
      "add",
      TEST_SOURCE,
      "--skill",
      SKILL_NAME,
      "--copy",
    ]);
  });

  it("prefers TAILOR_SDK_SKILLS_SOURCE env var over the passed source", () => {
    vi.stubEnv("TAILOR_SDK_SKILLS_SOURCE", "/override/skills");
    try {
      expect(buildSkillsAddArgs({ source: TEST_SOURCE })[2]).toBe("/override/skills");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("appends --agent and --yes when provided", () => {
    expect(
      buildSkillsAddArgs({ source: TEST_SOURCE, agent: "codex", yes: true }).slice(-3),
    ).toEqual(["--agent", "codex", "--yes"]);
  });

  it("runs npx with generated arguments and returns exit code", async () => {
    const mock = createMockChildProcess();
    const spawnFn = vi.fn(() => mock.process);

    const promise = runSkillsInstaller({
      source: TEST_SOURCE,
      agent: "codex",
      spawnFn,
    });

    expect(spawnFn).toHaveBeenCalledWith(
      expect.stringMatching(/^npx(\\.cmd)?$/),
      ["skills", "add", TEST_SOURCE, "--skill", SKILL_NAME, "--copy", "--agent", "codex"],
      { stdio: "inherit" },
    );

    mock.emitClose(0);
    await expect(promise).resolves.toBe(0);
  });

  it("returns 1 when child process exits without status code", async () => {
    const mock = createMockChildProcess();
    const spawnFn = vi.fn(() => mock.process);
    const promise = runSkillsInstaller({ source: TEST_SOURCE, spawnFn });

    mock.emitClose(null);
    await expect(promise).resolves.toBe(1);
  });

  it("rejects when npx execution fails", async () => {
    const mock = createMockChildProcess();
    const spawnFn = vi.fn(() => mock.process);
    const promise = runSkillsInstaller({ source: TEST_SOURCE, spawnFn });

    mock.emitError(new Error("spawn failed"));
    await expect(promise).rejects.toThrow("spawn failed");
  });
});

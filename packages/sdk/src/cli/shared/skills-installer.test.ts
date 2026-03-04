import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SKILLS_SOURCE,
  SKILL_NAME,
  buildSkillsAddArgs,
  runSkillsInstaller,
} from "./skills-installer";

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
  it("builds skills add arguments with default source", () => {
    expect(buildSkillsAddArgs([])).toEqual([
      "skills",
      "add",
      DEFAULT_SKILLS_SOURCE,
      "--skill",
      SKILL_NAME,
    ]);
  });

  it("appends user arguments after fixed skill options", () => {
    expect(buildSkillsAddArgs(["-a", "codex", "-y"]).slice(-3)).toEqual(["-a", "codex", "-y"]);
  });

  it("runs npx with generated arguments and returns exit code", async () => {
    const mock = createMockChildProcess();
    const spawnFn = vi.fn(() => mock.process);

    const promise = runSkillsInstaller({
      additionalArgs: ["-a", "codex"],
      spawnFn,
    });

    expect(spawnFn).toHaveBeenCalledWith(
      expect.stringMatching(/^npx(\\.cmd)?$/),
      ["skills", "add", DEFAULT_SKILLS_SOURCE, "--skill", SKILL_NAME, "-a", "codex"],
      { stdio: "inherit" },
    );

    mock.emitClose(0);
    await expect(promise).resolves.toBe(0);
  });

  it("returns 1 when child process exits without status code", async () => {
    const mock = createMockChildProcess();
    const spawnFn = vi.fn(() => mock.process);
    const promise = runSkillsInstaller({ spawnFn });

    mock.emitClose(null);
    await expect(promise).resolves.toBe(1);
  });

  it("rejects when npx execution fails", async () => {
    const mock = createMockChildProcess();
    const spawnFn = vi.fn(() => mock.process);
    const promise = runSkillsInstaller({ spawnFn });

    mock.emitError(new Error("spawn failed"));
    await expect(promise).rejects.toThrow("spawn failed");
  });
});

import { describe, expect, it } from "vitest";
import { buildContainerRunArgs, getContainerfileContent } from "./container";

describe("getContainerfileContent", () => {
  it("returns a valid Containerfile with required tools", () => {
    const content = getContainerfileContent();
    expect(content).toContain("FROM node:22-slim");
    expect(content).toContain("claude-code");
    expect(content).toContain("codex");
    expect(content).toContain("pnpm");
  });

  it("runs as non-root user", () => {
    const content = getContainerfileContent();
    expect(content).toContain("USER node");
  });
});

describe("buildContainerRunArgs", () => {
  it("builds correct args for Claude with workDir", () => {
    const args = buildContainerRunArgs("claude", ["-p", "hello", "--output-format", "json"], {
      workDir: "/tmp/sdk-ws-abc",
    });

    expect(args).toContain("run");
    expect(args).toContain("--rm");

    // Volume mount at same path
    const volumeIdx = args.indexOf("--volume");
    expect(volumeIdx).toBeGreaterThan(-1);
    expect(args[volumeIdx + 1]).toBe("/tmp/sdk-ws-abc:/tmp/sdk-ws-abc:Z");

    // Working directory
    const workdirIdx = args.indexOf("--workdir");
    expect(workdirIdx).toBeGreaterThan(-1);
    expect(args[workdirIdx + 1]).toBe("/tmp/sdk-ws-abc");

    // No -i flag for claude
    expect(args).not.toContain("-i");

    // Command after image name
    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(imageIdx).toBeGreaterThan(0);
    expect(args[imageIdx + 1]).toBe("claude");
    expect(args[imageIdx + 2]).toBe("-p");
    expect(args[imageIdx + 3]).toBe("hello");
  });

  it("builds correct args for Codex with stdin", () => {
    const args = buildContainerRunArgs("codex", ["exec", "--json", "--full-auto"], {
      workDir: "/tmp/sdk-ws-xyz",
      stdin: true,
    });

    // -i flag for stdin piping
    expect(args).toContain("-i");

    // Command
    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(args[imageIdx + 1]).toBe("codex");
  });

  it("omits volume mount when workDir is not provided", () => {
    const args = buildContainerRunArgs("claude", ["-p", "test"]);

    const workdirIdx = args.indexOf("--workdir");
    expect(workdirIdx).toBe(-1);
  });

  it("mounts workDir at the same path inside the container", () => {
    const workDir = "/tmp/sdk-ws-test123";
    const args = buildContainerRunArgs("claude", ["-p", "test"], { workDir });

    const volumeIdx = args.indexOf("--volume");
    expect(volumeIdx).toBeGreaterThan(-1);
    expect(args[volumeIdx + 1]).toBe(`${workDir}:${workDir}:Z`);
  });

  it("passes correct auth env var per agent", () => {
    const claudeArgs = buildContainerRunArgs("claude", ["-p", "test"]);
    const codexArgs = buildContainerRunArgs("codex", ["exec"]);

    // Claude uses CLAUDE_CODE_OAUTH_TOKEN
    expect(claudeArgs).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(claudeArgs).not.toContain("OPENAI_API_KEY");

    // Codex uses OPENAI_API_KEY
    expect(codexArgs).toContain("OPENAI_API_KEY");
    expect(codexArgs).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("does not mount auth directories", () => {
    const claudeArgs = buildContainerRunArgs("claude", ["-p", "test"]);
    const codexArgs = buildContainerRunArgs("codex", ["exec"]);

    // Auth dirs should NOT be mounted (causes Claude startup errors)
    const claudeVolumes = claudeArgs.filter((_, i) => i > 0 && claudeArgs[i - 1] === "--volume");
    const codexVolumes = codexArgs.filter((_, i) => i > 0 && codexArgs[i - 1] === "--volume");

    for (const v of [...claudeVolumes, ...codexVolumes]) {
      expect(v).not.toContain(".claude");
      expect(v).not.toContain(".codex");
    }
  });
});

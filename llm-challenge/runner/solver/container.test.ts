import os from "node:os";
import path from "node:path";
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

  it("uses env var auth for Claude (no dir mount)", () => {
    const args = buildContainerRunArgs("claude", ["-p", "test"]);

    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN");

    // Claude auth dir NOT mounted (causes .claude.json write errors)
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    for (const v of volumes) {
      expect(v).not.toContain(".claude");
    }
  });

  it("mounts ~/.codex read-only for Codex auth (no API key)", () => {
    const args = buildContainerRunArgs("codex", ["exec"]);
    const codexDir = path.join(os.homedir(), ".codex");

    // Should mount ~/.codex read-only
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    const codexMount = volumes.find((v) => v.includes(".codex"));
    expect(codexMount).toBe(`${codexDir}:/home/node/.codex:ro,Z`);

    // No API key env vars
    expect(args).not.toContain("OPENAI_API_KEY");
    expect(args).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
});

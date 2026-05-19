import { describe, expect, it } from "vitest";
import {
  CONTAINER_CODEX_AUTH,
  CONTAINER_CODEX_HOME,
  CONTAINER_WORK_DIR,
  buildContainerRunArgs,
  getContainerfileContent,
} from "./container";

describe("getContainerfileContent", () => {
  it("installs the codex CLI as the only agent binary", () => {
    const content = getContainerfileContent();
    expect(content).toContain("FROM node:22-slim");
    expect(content).toContain("@openai/codex");
    expect(content).toContain("pnpm");
    expect(content).toContain("ca-certificates");
  });

  it("does not install the retired opencode or claude-code agents", () => {
    const content = getContainerfileContent();
    expect(content).not.toContain("opencode");
    expect(content).not.toContain("claude-code");
    expect(content).not.toContain("ollama");
  });

  it("pre-creates CODEX_HOME owned by the node user", () => {
    const content = getContainerfileContent();
    // The host's read-only auth.json bind-mounts into this dir; codex itself
    // still needs the parent to be writable for transient session state.
    expect(content).toContain("/home/node/.codex");
    expect(content).toContain("chown -R node:node /home/node/.codex");
  });

  it("runs as non-root user", () => {
    const content = getContainerfileContent();
    expect(content).toContain("USER node");
  });
});

describe("buildContainerRunArgs", () => {
  const authPath = "/Users/dqn/.codex/auth.json";

  it("mounts the host workDir RW at the fixed container path", () => {
    const args = buildContainerRunArgs(["exec", "--json"], {
      workDir: "/var/folders/sn/abc123/T/sdk-ws-xyz",
      codexAuthPath: authPath,
    });

    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    expect(volumes).toContain(`/var/folders/sn/abc123/T/sdk-ws-xyz:${CONTAINER_WORK_DIR}:Z`);

    const workdirIdx = args.indexOf("--workdir");
    expect(workdirIdx).toBeGreaterThan(-1);
    expect(args[workdirIdx + 1]).toBe(CONTAINER_WORK_DIR);
  });

  it("invokes codex (not opencode) as the in-container executable", () => {
    const args = buildContainerRunArgs(["exec", "--json"], {
      workDir: "/tmp/sdk-ws-codex",
      codexAuthPath: authPath,
    });

    expect(args).toContain("run");
    expect(args).toContain("--rm");

    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(imageIdx).toBeGreaterThan(0);
    expect(args[imageIdx + 1]).toBe("codex");
    expect(args[imageIdx + 2]).toBe("exec");
  });

  it("attaches stdin so codex can read the prompt via `-`", () => {
    const args = buildContainerRunArgs(["exec", "--json"], {
      workDir: "/tmp/sdk-ws-codex",
      codexAuthPath: authPath,
    });
    expect(args).toContain("-i");
  });

  it("mounts the host's ~/.codex/auth.json read-only into CODEX_HOME", () => {
    const args = buildContainerRunArgs(["exec", "--json"], {
      workDir: "/tmp/sdk-ws-codex",
      codexAuthPath: authPath,
    });

    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    const authMount = volumes.find((v) => v.includes(CONTAINER_CODEX_AUTH));
    expect(authMount).toBe(`${authPath}:${CONTAINER_CODEX_AUTH}:ro,Z`);

    const envIdx = args.indexOf("--env");
    expect(envIdx).toBeGreaterThan(-1);
    expect(args[envIdx + 1]).toBe(`CODEX_HOME=${CONTAINER_CODEX_HOME}`);
  });

  it("does not poke holes in the network for legacy ollama / host services", () => {
    const args = buildContainerRunArgs(["exec", "--json"], {
      workDir: "/tmp/sdk-ws-codex",
      codexAuthPath: authPath,
    });
    expect(args).not.toContain("--add-host");
    expect(JSON.stringify(args)).not.toContain("host.containers.internal");
    expect(JSON.stringify(args)).not.toContain("ollama");
  });

  it("does not leak unrelated host paths (no $HOME, no /etc, no skills)", () => {
    const args = buildContainerRunArgs(["exec", "--json"], {
      workDir: "/tmp/sdk-ws-codex",
      codexAuthPath: authPath,
    });
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    // The only mounts we expect are workDir and the codex auth file.
    expect(volumes).toHaveLength(2);
    for (const v of volumes) {
      expect(v).not.toContain(".claude");
      expect(v).not.toContain("AGENTS.md");
      expect(v).not.toMatch(/skills\b/);
    }
  });
});

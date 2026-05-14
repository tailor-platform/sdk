import { describe, expect, it } from "vitest";
import { CONTAINER_WORK_DIR, buildContainerRunArgs, getContainerfileContent } from "./container";

describe("getContainerfileContent", () => {
  it("returns a valid Containerfile installing opencode", () => {
    const content = getContainerfileContent();
    expect(content).toContain("FROM node:22-slim");
    expect(content).toContain("opencode-ai");
    expect(content).toContain("pnpm");
    expect(content).toContain("ca-certificates");
  });

  it("does not install the retired Claude Code or Codex CLIs", () => {
    const content = getContainerfileContent();
    expect(content).not.toContain("claude-code");
    expect(content).not.toContain("@openai/codex");
    // The verbatim word "codex" should also not appear (avoids a "codex" mkdir
    // command resurfacing as part of legacy cleanup).
    expect(content).not.toContain(".codex");
  });

  it("pre-creates the opencode config + state dirs as the node user", () => {
    const content = getContainerfileContent();
    // Both XDG dirs must be writable by the runtime user; otherwise opencode's
    // first-run sqlite migration fails inside the container.
    expect(content).toContain("/home/node/.config/opencode");
    expect(content).toContain("/home/node/.local/share/opencode");
  });

  it("runs as non-root user", () => {
    const content = getContainerfileContent();
    expect(content).toContain("USER node");
  });
});

describe("buildContainerRunArgs", () => {
  it("mounts host workDir to fixed container path", () => {
    const args = buildContainerRunArgs(["run", "--format", "json"], {
      workDir: "/var/folders/sn/abc123/T/sdk-ws-xyz",
    });

    const volumeIdx = args.indexOf("--volume");
    expect(volumeIdx).toBeGreaterThan(-1);
    expect(args[volumeIdx + 1]).toBe(`/var/folders/sn/abc123/T/sdk-ws-xyz:${CONTAINER_WORK_DIR}:Z`);

    const workdirIdx = args.indexOf("--workdir");
    expect(workdirIdx).toBeGreaterThan(-1);
    expect(args[workdirIdx + 1]).toBe(CONTAINER_WORK_DIR);
  });

  it("invokes opencode (not 'oss') as the in-container executable", () => {
    const args = buildContainerRunArgs(["run", "--format", "json"], {
      workDir: "/tmp/sdk-ws-oss",
    });

    expect(args).toContain("run");
    expect(args).toContain("--rm");

    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(imageIdx).toBeGreaterThan(0);
    // First positional after the image is the in-container executable. opencode
    // has no `oss` sub-command, so this is load-bearing.
    expect(args[imageIdx + 1]).toBe("opencode");
    expect(args[imageIdx + 2]).toBe("run");
  });

  it("omits volume mount when workDir is not provided", () => {
    const args = buildContainerRunArgs(["run"]);

    expect(args).not.toContain("--workdir");
    expect(
      args
        .filter((_, i) => i > 0 && args[i - 1] === "--volume")
        .every((v) => !v.includes(CONTAINER_WORK_DIR)),
    ).toBe(true);
  });

  it("adds host-loopback so the container can reach the host's Ollama daemon", () => {
    const args = buildContainerRunArgs(["run", "--format", "json"], {
      workDir: "/tmp/sdk-ws-oss",
    });

    // Host-loopback is what lets the container reach the host's `ollama serve`
    // via http://host.containers.internal:11434 — verified in the Phase 2
    // smoke test.
    const hostIdx = args.indexOf("--add-host");
    expect(hostIdx).toBeGreaterThan(-1);
    expect(args[hostIdx + 1]).toBe("host.containers.internal:host-gateway");
  });

  it("mounts no cloud credentials and no agent auth files", () => {
    const args = buildContainerRunArgs(["run"], {
      workDir: "/tmp/sdk-ws-oss",
    });

    expect(args).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(args).not.toContain("OPENAI_API_KEY");
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    for (const v of volumes) {
      expect(v).not.toContain(".codex/auth.json");
      expect(v).not.toContain(".claude");
    }
  });

  it("mounts the opencode.json read-only when opencodeConfigPath is provided", () => {
    const args = buildContainerRunArgs(["run", "--format", "json"], {
      workDir: "/tmp/sdk-ws-oss",
      opencodeConfigPath: "/var/folders/x/T/llm-oss-cfg-abc/opencode.json",
    });
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    const configMount = volumes.find((v) => v.includes("/.config/opencode/opencode.json"));
    expect(configMount).toBe(
      "/var/folders/x/T/llm-oss-cfg-abc/opencode.json:/home/node/.config/opencode/opencode.json:ro,Z",
    );
  });
});

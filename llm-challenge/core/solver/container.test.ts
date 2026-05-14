import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTAINER_WORK_DIR, buildContainerRunArgs, getContainerfileContent } from "./container";

describe("getContainerfileContent", () => {
  it("returns a valid Containerfile with required tools", () => {
    const content = getContainerfileContent();
    expect(content).toContain("FROM node:22-slim");
    expect(content).toContain("claude-code");
    expect(content).toContain("codex");
    expect(content).toContain("opencode-ai");
    expect(content).toContain("pnpm");
    expect(content).toContain("ca-certificates");
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
    const args = buildContainerRunArgs("claude", ["-p", "hello"], {
      workDir: "/var/folders/sn/abc123/T/sdk-ws-xyz",
    });

    const volumeIdx = args.indexOf("--volume");
    expect(volumeIdx).toBeGreaterThan(-1);
    expect(args[volumeIdx + 1]).toBe(`/var/folders/sn/abc123/T/sdk-ws-xyz:${CONTAINER_WORK_DIR}:Z`);

    const workdirIdx = args.indexOf("--workdir");
    expect(workdirIdx).toBeGreaterThan(-1);
    expect(args[workdirIdx + 1]).toBe(CONTAINER_WORK_DIR);
  });

  it("builds correct args for Claude", () => {
    const args = buildContainerRunArgs("claude", ["-p", "hello", "--output-format", "json"], {
      workDir: "/tmp/sdk-ws-abc",
    });

    expect(args).toContain("run");
    expect(args).toContain("--rm");
    expect(args).not.toContain("-i");

    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(imageIdx).toBeGreaterThan(0);
    expect(args[imageIdx + 1]).toBe("claude");
    expect(args[imageIdx + 2]).toBe("-p");
  });

  it("builds correct args for Codex with stdin", () => {
    const args = buildContainerRunArgs("codex", ["exec", "--json", "--full-auto"], {
      workDir: "/tmp/sdk-ws-xyz",
      stdin: true,
    });

    expect(args).toContain("-i");

    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(args[imageIdx + 1]).toBe("codex");
  });

  it("omits volume mount when workDir is not provided", () => {
    const args = buildContainerRunArgs("claude", ["-p", "test"]);

    expect(args).not.toContain("--workdir");
    expect(
      args
        .filter((_, i) => i > 0 && args[i - 1] === "--volume")
        .every((v) => !v.includes(CONTAINER_WORK_DIR)),
    ).toBe(true);
  });

  it("uses env var auth for Claude (no dir mount)", () => {
    const args = buildContainerRunArgs("claude", ["-p", "test"]);

    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN");

    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    for (const v of volumes) {
      expect(v).not.toContain(".claude");
    }
  });

  it("mounts only ~/.codex/auth.json read-only for Codex auth (no API key)", () => {
    const args = buildContainerRunArgs("codex", ["exec"]);
    const codexAuth = path.join(os.homedir(), ".codex", "auth.json");

    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    const codexMount = volumes.find((v) => v.includes(".codex"));
    expect(codexMount).toBe(`${codexAuth}:/home/node/.codex/auth.json:ro,Z`);

    expect(args).not.toContain("OPENAI_API_KEY");
    expect(args).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  // Regression guard: buildContainerRunArgs unconditionally wires the codex
  // auth.json mount even when the host file does not exist. The Podman run
  // call surfaces the missing-source error at runtime; this test pins the
  // current behavior so a future refactor cannot silently drop the mount.
  it("wires the codex auth.json mount unconditionally for the codex agent", () => {
    const args = buildContainerRunArgs("codex", ["exec", "--json"], {
      workDir: "/tmp/sdk-ws-codex",
      stdin: true,
    });
    const codexAuth = path.join(os.homedir(), ".codex", "auth.json");
    const expectedMount = `${codexAuth}:/home/node/.codex/auth.json:ro,Z`;

    expect(args).toContain("--volume");
    expect(args).toContain(expectedMount);
    expect(expectedMount).toMatch(/:ro,Z$/);
  });

  it("adds host-loopback for the oss agent and mounts no credentials", () => {
    const args = buildContainerRunArgs("oss", ["run", "--format", "json"], {
      workDir: "/tmp/sdk-ws-oss",
      executable: "opencode",
    });

    // Host-loopback is what lets the container reach the host's `ollama serve`
    // via http://host.containers.internal:11434 — verified in the Phase 2
    // smoke test.
    const hostIdx = args.indexOf("--add-host");
    expect(hostIdx).toBeGreaterThan(-1);
    expect(args[hostIdx + 1]).toBe("host.containers.internal:host-gateway");

    // No cloud credentials should be passed in for the OSS path.
    expect(args).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    for (const v of volumes) {
      expect(v).not.toContain(".codex/auth.json");
      expect(v).not.toContain(".claude");
    }
  });

  it("mounts the opencode.json read-only when opencodeConfigPath is provided", () => {
    const args = buildContainerRunArgs("oss", ["run", "--format", "json"], {
      workDir: "/tmp/sdk-ws-oss",
      opencodeConfigPath: "/var/folders/x/T/llm-oss-cfg-abc/opencode.json",
      executable: "opencode",
    });
    const volumes = args.filter((_, i) => i > 0 && args[i - 1] === "--volume");
    const configMount = volumes.find((v) => v.includes("/.config/opencode/opencode.json"));
    expect(configMount).toBe(
      "/var/folders/x/T/llm-oss-cfg-abc/opencode.json:/home/node/.config/opencode/opencode.json:ro,Z",
    );
  });

  it("uses the executable override so the container runs `opencode`, not `oss`", () => {
    const args = buildContainerRunArgs("oss", ["run", "--format", "json"], {
      workDir: "/tmp/sdk-ws-oss",
      executable: "opencode",
    });
    const imageIdx = args.indexOf("llm-challenge-runner");
    expect(imageIdx).toBeGreaterThan(0);
    // First positional after the image is the in-container executable; opencode
    // has no `oss` sub-command, so the override is load-bearing.
    expect(args[imageIdx + 1]).toBe("opencode");
    expect(args[imageIdx + 2]).toBe("run");
  });
});
